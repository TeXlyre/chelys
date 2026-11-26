// src/plugin-host/RecipeManager.ts
import { nanoid } from 'nanoid';

import {
	applyPlatform,
	detectArch,
	detectPlatform,
	dockerPlatform,
	type ArchId,
} from './platformResolution';
import { pluginTypeRegistry } from './PluginTypeRegistry';
import { processSupervisorService } from './ProcessSupervisorService';
import { withSanitizedIcon } from './recipeIcon';
import { recipeRegistry } from './RecipeRegistry';
import { recipeStore } from './RecipeStore';
import {
	effectiveValues,
	registryPullSteps,
	resolveRecipe,
} from './variableResolution';
import { invoke } from '@tauri-apps/api/core';
import { getStoredSetting } from '../config';
import { appDataDir } from '@tauri-apps/api/path';
import { routeEndpoint } from './traefikRoutes';
import { dockerVolumeArgs, dockerVolumeName } from './dockerVolumes';
import {
	containerStateFromInspect,
	type ExistingContainerState,
} from './containerState';
import { materializeRecipeFiles } from './recipeWorkdir';
import {
	findMode,
	type ContainerEngine,
	type DockerInstallSource,
	type InstallModeKind,
	type InstallStep,
	type PlatformId,
	type Recipe,
	type RecipeStatus,
	type RegistryEntry,
} from './types';

import { SERVICE_TYPE, SERVICE_PREFIX, ENDPOINT_PREFIX, instanceRecipeId, serviceMembers, validateService, type ServiceMember } from '../plugins/service/shared';

export type ServiceMemberAuthorization = (type: string, registering: boolean) => Promise<void>;
import { ENDPOINT_TYPE, readEndpointTransport } from '../plugins/endpoint/shared';
import { getInstanceId } from '../control/protocol';
import { accountStores } from '../control/stores';
import { getActiveAccountId } from './activeAccount';
import { callRemotePeer, listAvailablePeers } from '../control/client';

const LOG_TAIL_LIMIT = 200;
const INSTALLED_KEY = 'chelys-installed-recipes';
const CONTAINER_ENGINES_KEY = 'chelys-container-engines';

type StatusListener = (statuses: Map<string, RecipeStatus>) => void;

interface InstalledRecord {
	mode: InstallModeKind;
	version?: string;
	containerEngine?: ContainerEngine;
}

const containerName = (recipeId: string): string =>
	`chelys-${recipeId}`.replace(/[^a-zA-Z0-9_.-]/g, '-');

const errorMessage = (error: unknown, fallback: string): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string' && error.trim()) return error;
	return fallback;
};

class RecipeManager {
	private recipes = new Map<string, Recipe>();
	private statuses = new Map<string, RecipeStatus>();
	private listeners = new Set<StatusListener>();
	private initialized = false;
	private platform: PlatformId = 'desktop';
	private arch: ArchId | null = null;
	private reattached = new Set<string>();
	private cancelling = new Set<string>();
	private starting = new Map<string, Promise<void>>();
    private installing = new Map<string, Promise<void>>();
    private memberSetup = new Map<string, Promise<void>>();
    private remoteChecks = new Map<string, Map<string, string>>();
    private persistQueue: Promise<void> = Promise.resolve();
    private memberStarted: ((id: string) => void) | undefined;

    setServiceMemberStartedListener(listener: (id: string) => void): void { this.memberStarted = listener; }
	private ports = new Map<string, Record<string, string>>();

	async reinjectRunning(): Promise<void> {
		if (!this.initialized) return;
        if (getActiveAccountId()) {
            for (const [prefix, type] of [[SERVICE_PREFIX, SERVICE_TYPE], [ENDPOINT_PREFIX, ENDPOINT_TYPE]]) {
                const own = prefix + getInstanceId() + '.';
                for (const key of accountStores.list('settings')) {
                    if (!key.startsWith(own)) continue;
                    const id = key.slice(own.length);
                    if (this.recipes.get(id)?.type !== type || this.statuses.get(id)?.state !== 'running') accountStores.delete('settings', key);
                }
            }
        }

		for (const [id, status] of this.statuses) {
			if (status.state !== 'running') continue;

			const base = this.recipes.get(id);
			if (!base) continue;

            if (base.type === SERVICE_TYPE) this.publishService(base);
            else this.runStartHook(await this.resolveForCurrentPlatform(base));
		}
	}

	private async resolveForCurrentPlatform(base: Recipe): Promise<Recipe> {
		this.platform = await detectPlatform();
		this.arch = await detectArch();

		const pinned = this.ports.get(base.id);
		const source = pinned ? { ...base, variableValues: pinned } : base;

		const resolved = resolveRecipe(applyPlatform(source, this.platform));
		const expanded = await this.expandRuntimeTokens(resolved);

		if (
			this.statuses.get(base.id)?.mode === 'docker' &&
			this.containerEngineForRuntime(base.id) === 'podman' &&
			typeof expanded.typeConfig.transportUrl === 'string'
		) {
			expanded.typeConfig.transportUrl =
				expanded.typeConfig.transportUrl.replace(
					/^ws:\/\/localhost(?=[:/])/i,
					'ws://127.0.0.1',
				);
		}

		return expanded;
	}

	private async allocatePorts(base: Recipe): Promise<void> {
		if (this.ports.has(base.id)) return;

		const fallback = getStoredSetting<boolean>('dynamicPortFallback');
		const values = effectiveValues(base);
		const assigned: Record<string, string> = {};

		for (const [key, value] of Object.entries(values)) {
			if (!/port$/i.test(key) || !/^\d+$/.test(value)) continue;

			const free = await invoke<number>('find_free_port', {
				preferred: Number(value),
				fallback,
			}).catch(() => Number(value));

			if (free === 0) {
				this.appendLog(base.id, `Port ${value} is unavailable`);
				continue;
			}

			if (String(free) === value) continue;

			assigned[key] = String(free);
			this.appendLog(base.id, `Port ${value} unavailable, using ${free}`);
		}

		this.ports.set(base.id, { ...(base.variableValues ?? {}), ...assigned });
	}

	private async adoptContainerPort(recipe: Recipe): Promise<void> {
		const values = effectiveValues(recipe);
		const portKey = Object.keys(values).find((key) => /port$/i.test(key));
		if (!portKey) return;

		const out: string[] = [];

		const unsubscribe = processSupervisorService.onOutput(
			({ handleId, line }) => {
				if (handleId === `${recipe.id}-port`) out.push(line);
			},
		);

		const code = await processSupervisorService
			.runCommand(`${recipe.id}-port`, {
				command: this.containerEngineForRuntime(recipe.id),
				args: ['port', containerName(recipe.id)],
				env: {},
			})
			.catch(() => 1);

		unsubscribe();
		if (code !== 0) return;

		const match = out.join('\n').match(/:(\d+)\s*$/m);
		if (!match) return;

		this.ports.set(recipe.id, {
			...(recipe.variableValues ?? {}),
			[portKey]: match[1],
		});
	}

	private async expandRuntimeTokens(recipe: Recipe): Promise<Recipe> {
		const tokens: Record<string, string> = {
			'${CHELYS_DATA}': await appDataDir(),
			'${CHELYS_ROUTE_ENDPOINT}': await routeEndpoint(),
			'${CHELYS_ARCH}': this.arch ?? '',
		};

		const expand = <T>(value: T): T => {
			if (typeof value === 'string') {
				let out: string = value;
				for (const [token, replacement] of Object.entries(tokens)) {
					out = out.split(token).join(replacement);
				}
				return out as unknown as T;
			}
			if (Array.isArray(value)) {
				return value.map(expand) as unknown as T;
			}
			if (value && typeof value === 'object') {
				const result: Record<string, unknown> = {};
				for (const [key, inner] of Object.entries(value)) {
					result[key] = expand(inner);
				}
				return result as T;
			}
			return value;
		};

		return expand(recipe);
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		await processSupervisorService.initialize();
		this.platform = await detectPlatform();

		const seeds = pluginTypeRegistry.seeds();
		const stored = await recipeStore.load();
		const byId = new Map<string, Recipe>();

		for (const recipe of [...seeds, ...stored]) {
			byId.set(recipe.id, withSanitizedIcon(recipe));
		}

		this.recipes = byId;

		const installed = this.readInstalled();
		const running = new Set(await processSupervisorService.listRunning());

		for (const recipe of this.recipes.values()) {
			const record = installed.get(recipe.id);

			this.statuses.set(recipe.id, {
				recipeId: recipe.id,
				state: running.has(recipe.id)
					? 'running'
					: record
						? 'installed'
						: 'not-installed',
				mode: record?.mode ?? recipe.selectedMode ?? null,
				lastError: null,
				logTail: [],
			});
		}

		processSupervisorService.onOutput(({ handleId, line }) => {
			this.appendLog(handleId, line);
		});

		processSupervisorService.onStatus(({ handleId, status }) => {
			if (status !== 'exited' && status !== 'failed' && status !== 'stopped') {
				return;
			}

			if (this.reattached.has(handleId)) return;

			const current = this.statuses.get(handleId);

			if (current?.state === 'running') {
				this.patch(handleId, { state: 'stopped' });

				const recipe = this.recipes.get(handleId);
				if (recipe) this.runStopHook(recipe);
			}
		});

		await this.reattachDockerRecipes(running);
		this.emit();
	}

	listRecipes(): Recipe[] {
		return Array.from(this.recipes.values());
	}

    isInstalled(recipeId: string): boolean { return this.readInstalled().has(recipeId); }

    getStatus(recipeId: string): RecipeStatus | undefined {
        const status = this.statuses.get(recipeId);
        const recipe = this.recipes.get(recipeId);
        if (status?.state !== 'running' || recipe?.type !== SERVICE_TYPE) return status;
        try {
            const unavailable = this.serviceMemberStatuses(recipe).filter(member => member.state !== 'running');
            return unavailable.length ? { ...status, groupActive: true, state: 'error', lastError: `Unavailable: ${unavailable.map(m => m.reference).join(', ')}` } : status;
        } catch (error) { return { ...status, groupActive: true, state: 'error', lastError: errorMessage(error, 'Invalid service') }; }
    }

    private localMember(member: ServiceMember): boolean {
        return !member.instanceId || member.instanceId === getInstanceId();
    }

    serviceMemberStatuses(recipe: Recipe) {
        if (recipe.type !== SERVICE_TYPE) return [];
        const peers = new Set(listAvailablePeers().filter(peer => peer.controlAvailable && peer.peerKind === 'chelys' && peer.transport === 'webrtc').map(peer => peer.id));
        let members: ServiceMember[];
        try { members = serviceMembers(recipe); } catch { return []; }
        return members.map(member => {
            const local = this.localMember(member);
            const reference = member.instanceId ? `${member.instanceId}/${member.recipeId}` : member.recipeId;
            const state = local ? this.statuses.get(member.recipeId)?.state ?? 'missing' : peers.has(member.instanceId) ? this.remoteChecks.get(recipe.id)?.get(reference) ?? 'unchecked' : 'offline';
            return { reference, recipeId: member.recipeId, local, name: local ? this.recipes.get(member.recipeId)?.name ?? member.recipeId : member.recipeId, state };
        });
    }

    private publishService(recipe: Recipe): void {
        if (!getActiveAccountId()) return;
        const instanceId = getInstanceId();
        const id = instanceRecipeId(instanceId, recipe.id);
        accountStores.set('settings', SERVICE_PREFIX + id, { id, name: recipe.name, members: serviceMembers(recipe).map(member => instanceRecipeId(member.instanceId ?? instanceId, member.recipeId)) });
    }

    private withdrawService(id: string): void {
        if (!getActiveAccountId()) return;
        const key = SERVICE_PREFIX + instanceRecipeId(getInstanceId(), id);
        if (accountStores.list('settings').includes(key)) accountStores.delete('settings', key);
    }

    /** Export only an independently configured connection, never the account room or upstream URL. */
    async connectionDescriptor(id: string): Promise<Record<string, unknown>> {
        const recipe = this.recipes.get(id);
        if (!recipe || ![ENDPOINT_TYPE, 'storage'].includes(recipe.type) || this.getStatus(id)?.state !== 'running') throw Error('Start a storage or endpoint recipe first');
        const resolved = await this.resolveForCurrentPlatform(recipe);
        const descriptor = pluginTypeRegistry.get(recipe.type)?.toConfigBlock?.(resolved);
        if (!descriptor || typeof descriptor.id !== 'string') throw Error('Recipe has no connection descriptor');
        return { ...descriptor, kind: recipe.type === 'storage' ? 'storage' : 'service' };
    }

    async authorizeServiceMembers(id: string, operation: 'install' | 'run', authorize: ServiceMemberAuthorization): Promise<void> {
        const group = this.recipes.get(id);
        if (group?.type !== SERVICE_TYPE) return;
        for (const member of serviceMembers(group)) {
            if (!this.localMember(member)) continue;
            const recipe = this.recipes.get(member.recipeId);
            if (recipe?.type === SERVICE_TYPE) throw Error('Nested services are not supported');
            if (operation === 'run') {
                if (!recipe || !this.readInstalled().has(recipe.id)) throw Error(`Install member ${member.recipeId} first`);
                if (this.statuses.get(recipe.id)?.state !== 'running') await authorize(recipe.type, false);
            } else if (!recipe || !this.readInstalled().has(member.recipeId) || this.statuses.get(member.recipeId)?.state === 'error') {
                const entry = recipe ?? (await recipeRegistry.list()).find(item => item.id === member.recipeId);
                if (!entry || entry.type === SERVICE_TYPE) throw Error(`Plugin not found in registry: ${member.recipeId}`);
                await authorize(entry.type, !recipe);
            }
        }
    }

    private async installMember(id: string, source: DockerInstallSource, authorize?: ServiceMemberAuthorization): Promise<void> {
        // Authorize even when joining an installation initiated by another caller.
        const existing = this.recipes.get(id);
        const entry = existing ? undefined : (await recipeRegistry.list()).find(item => item.id === id);
        if (!existing && !entry) throw Error(`Plugin not found in registry: ${id}`);
        if (!existing || !this.readInstalled().has(id) || this.statuses.get(id)?.state === 'error') await authorize?.((existing ?? entry!).type, !existing);
        const pending = this.memberSetup.get(id);
        if (pending) return pending;
        const operation = (async () => {
            let recipe = this.recipes.get(id);
            if (!recipe) {
                const entry = (await recipeRegistry.list()).find(item => item.id === id);
                if (!entry || entry.type === SERVICE_TYPE) throw Error(`Plugin not found in registry: ${id}`);
                await authorize?.(entry.type, true);
                recipe = this.recipes.get(id) ?? await this.installFromRegistry(entry);
            }
            if (recipe.type === SERVICE_TYPE) throw Error('Nested services are not supported');
            await this.installing.get(id);
            if (this.readInstalled().has(id) && this.statuses.get(id)?.state !== 'error') return;
            await authorize?.(recipe.type, false);
            const mode = recipe.selectedMode ?? recipe.modes.find(item => item.kind === 'docker')?.kind ?? recipe.modes[0]?.kind;
            if (!mode) throw Error(`No install mode for ${id}`);
            await this.install(id, mode, source);
            if (!this.readInstalled().has(id) || this.statuses.get(id)?.state === 'error') throw Error(this.statuses.get(id)?.lastError ?? `Could not install ${id}`);
        })();
        this.memberSetup.set(id, operation);
        try { await operation; } finally { this.memberSetup.delete(id); }
    }

    private async checkRemoteMembers(recipe: Recipe): Promise<void> {
        const checks = new Map<string, string>();
        this.remoteChecks.set(recipe.id, checks);
        const hosts = new Map<string, ServiceMember[]>();
        for (const member of serviceMembers(recipe)) {
            if (this.localMember(member) || !member.instanceId) continue;
            const list = hosts.get(member.instanceId) ?? [];
            list.push(member); hosts.set(member.instanceId, list);
        }
        for (const [host, members] of hosts) {
            try {
                if (!listAvailablePeers().some(peer => peer.id === host && peer.controlAvailable && peer.peerKind === 'chelys' && peer.transport === 'webrtc')) throw Error('Remote unavailable');
                const inventory = await callRemotePeer(host, 'recipes.list') as Array<{ id: string; state: string; type: string }>;
                for (const member of members) {
                    const match = inventory.find(item => item.id === member.recipeId && item.type !== SERVICE_TYPE);
                    checks.set(`${host}/${member.recipeId}`, match?.state ?? 'missing');
                }
            } catch {
                for (const member of members) checks.set(`${host}/${member.recipeId}`, 'unavailable');
            }
        }
    }

    async refreshServiceMembers(id: string): Promise<void> {
        const recipe = this.recipes.get(id);
        if (!recipe || recipe.type !== SERVICE_TYPE) throw Error('Unknown service');
        await this.checkRemoteMembers(recipe);
        this.emit();
    }

	subscribe(listener: StatusListener): () => void {
		this.listeners.add(listener);
		listener(new Map(this.statuses));
		return () => this.listeners.delete(listener);
	}

	async save(recipe: Recipe): Promise<Recipe> {
		const id = recipe.id || nanoid();
		const stored: Recipe = withSanitizedIcon({ ...recipe, id });
        const previous = this.recipes.get(id);
        if (previous && previous.type !== stored.type) throw Error('Recipe type cannot be changed; create a new recipe');
        if (stored.type === SERVICE_TYPE) {
            validateService(stored);
            const references = serviceMembers(stored).map(member => `${member.instanceId ?? getInstanceId()}/${member.recipeId}`);
            if (new Set(references).size !== references.length) throw Error('Duplicate plugin instance');
            for (const member of serviceMembers(stored)) if (this.localMember(member) && (member.recipeId === id || this.recipes.get(member.recipeId)?.type === SERVICE_TYPE)) throw Error('Nested services are not supported');
            if (['running', 'starting', 'installing', 'stopping'].includes(this.statuses.get(id)?.state ?? '')) throw Error('Stop the service before editing membership');
            if (previous && JSON.stringify(previous.typeConfig.members) !== JSON.stringify(stored.typeConfig.members)) {
                this.setInstalled(id, null);
                this.patch(id, { state: 'not-installed', mode: null });
            }
        }

		this.recipes.set(id, stored);

		if (!this.statuses.has(id)) {
			this.statuses.set(id, {
				recipeId: id,
				state: 'not-installed',
				mode: stored.selectedMode ?? null,
				lastError: null,
				logTail: [],
			});
		}

		await this.persistUserRecipes();
		this.emit();

		return stored;
	}

	async remove(recipeId: string): Promise<void> {
		await this.stop(recipeId);

		this.recipes.delete(recipeId);
		this.statuses.delete(recipeId);
		this.setInstalled(recipeId, null);
		this.setContainerEngineOverride(recipeId, null);

		await this.persistUserRecipes();
		this.emit();
	}

	async cancelInstall(recipeId: string): Promise<void> {
		this.cancelling.add(recipeId);
        if (this.recipes.get(recipeId)?.type === SERVICE_TYPE) return;
		await processSupervisorService.stop(recipeId);
	}

	private async verifyStorageVolumes(
		recipe: Recipe,
		engine: ContainerEngine,
		initialize: boolean,
		initializeVolumes = false,
	): Promise<void> {
		if (recipe.type !== 'storage') return;
		const volumes = findMode(recipe, 'docker')?.volumes ?? [];
		for (const volume of volumes) {
			const name = dockerVolumeName(recipe.id, volume.id, volume.name);
			const exists = await processSupervisorService
				.runCommand(`${recipe.id}-volume-check`, {
					command: engine,
					args: ['volume', 'inspect', name],
					env: {},
				})
				.then((code) => code === 0)
				.catch(() => false);
			if (exists) continue;
			if (!initialize) {
				throw new Error(
					`Storage volume "${name}" is missing or inaccessible in ${engine}. Restore the original volume and credentials before starting.`,
				);
			}
			if (
				!initializeVolumes &&
				!(
					typeof window !== 'undefined' &&
					typeof window.confirm === 'function' &&
					window.confirm(
						`Storage volume "${name}" does not exist in ${engine}. Create a NEW empty volume? If this is a reinstall, cancel and restore the original Garage volume instead.`,
					)
				)
			) {
				throw new Error('Storage volume initialization cancelled');
			}
			const code = await processSupervisorService.runCommand(
				`${recipe.id}-volume-create`,
				{ command: engine, args: ['volume', 'create', name], env: {} },
			);
			if (code !== 0)
				throw new Error(`Could not create storage volume "${name}"`);
		}
	}

	async install(
		recipeId: string,
		mode: InstallModeKind,
		source: DockerInstallSource = 'build',
		options: { initializeVolumes?: boolean; authorizeMember?: ServiceMemberAuthorization } = {},
	): Promise<void> {
        const pending = this.installing.get(recipeId);
        if (pending) return pending;
        const operation = this.installOnce(recipeId, mode, source, options);
        this.installing.set(recipeId, operation);
        try { await operation; } finally { this.installing.delete(recipeId); }
    }

    private async installOnce(recipeId: string, mode: InstallModeKind, source: DockerInstallSource, options: { initializeVolumes?: boolean; authorizeMember?: ServiceMemberAuthorization }): Promise<void> {
		const base = this.recipes.get(recipeId);
		if (!base) return;
        if (base.type === SERVICE_TYPE) {
            if (mode !== 'connect') throw Error('Services use group installation');
            if (this.statuses.get(recipeId)?.state === 'running') throw Error('Stop the service before reinstalling');
            this.patch(recipeId, { state: 'installing', mode, lastError: null, logTail: [] });
            try {
                for (const member of serviceMembers(base)) {
                    if (this.cancelling.has(recipeId)) throw Error('Service installation cancelled');
                    if (!this.localMember(member)) continue;
                    if (member.recipeId === recipeId) throw Error('Nested services are not supported');
                    this.appendLog(recipeId, `Preparing ${member.recipeId}`);
                    await this.installMember(member.recipeId, source, options.authorizeMember);
                }
                if (this.cancelling.has(recipeId)) throw Error('Service installation cancelled');
                this.setInstalled(recipeId, { mode, version: base.version });
                this.patch(recipeId, { state: 'installed' });
            } catch (error) {
                this.patch(recipeId, { state: 'error', lastError: errorMessage(error, 'Service installation failed') });
            } finally { this.cancelling.delete(recipeId); }
            return;
        }

		const recipe = await this.resolveForCurrentPlatform(base);
		const containerEngine =
			mode === 'docker' ? this.containerEngineForInstall(recipeId) : undefined;

		this.patch(recipeId, {
			state: 'installing',
			mode,
			lastError: null,
			logTail: [],
		});

		try {
			const workdir = (await materializeRecipeFiles(recipe)) ?? undefined;

			if (mode === 'system') {
				const system = findMode(recipe, 'system');
				if (!system) throw new Error('System mode not supported');

				await this.runSteps(recipe, system.installSteps, workdir);
			} else if (mode === 'docker') {
				const docker = findMode(recipe, 'docker');
				if (!docker) throw new Error('Container mode not supported');
				if (!containerEngine) throw new Error('Container engine unavailable');
				await this.verifyStorageVolumes(
					recipe,
					containerEngine,
					this.readInstalled().get(recipeId)?.mode !== 'docker',
					options.initializeVolumes ?? false,
				);

				await this.runSteps(
					recipe,
					source === 'registry'
						? registryPullSteps(docker, dockerPlatform(this.arch))
						: docker.buildSteps,
					workdir,
					containerEngine,
				);
			} else if (mode === 'connect') {
			}

			this.setInstalled(recipeId, {
				mode,
				version: this.recipes.get(recipeId)?.version,
				containerEngine,
			});

			this.patch(recipeId, { state: 'installed' });
		} catch (error) {
			const message = errorMessage(error, 'install failed');
			this.appendLog(recipeId, `Install failed: ${message}`);
			this.patch(recipeId, { state: 'error', lastError: message });
		} finally {
			this.cancelling.delete(recipeId);
		}
	}

	async run(recipeId: string, authorizeMember?: ServiceMemberAuthorization): Promise<void> {
		const pending = this.starting.get(recipeId);
		if (pending) return pending;
		const operation = this.runOnce(recipeId, authorizeMember);
		this.starting.set(recipeId, operation);
		try {
			await operation;
		} finally {
			this.starting.delete(recipeId);
		}
	}

	private async runOnce(recipeId: string, authorizeMember?: ServiceMemberAuthorization): Promise<void> {
		const base = this.recipes.get(recipeId);
		if (!base) return;

		const status = this.statuses.get(recipeId);
		const mode = status?.mode;
        if (base.type === SERVICE_TYPE) {
            if (!this.readInstalled().has(recipeId)) { this.patch(recipeId, { state: 'error', lastError: 'Install the service first' }); return; }
            this.patch(recipeId, { state: 'starting', lastError: null });
            try {
                await this.checkRemoteMembers(base);
                const unavailable = this.serviceMemberStatuses(base).filter(member => !member.local && member.state !== 'running');
                if (unavailable.length) throw Error(`Remote plugins unavailable: ${unavailable.map(member => member.reference).join(', ')}`);
                for (const member of serviceMembers(base)) {
                    if (!this.localMember(member)) continue;
                    await this.installing.get(member.recipeId);
                    const plugin = this.recipes.get(member.recipeId);
                    if (!plugin || plugin.type === SERVICE_TYPE || !this.readInstalled().has(plugin.id)) throw Error(`Install member ${member.recipeId} first`);
                    if (this.statuses.get(plugin.id)?.state !== 'running') {
                        await authorizeMember?.(plugin.type, false);
                        await this.run(plugin.id);
                    }
                    if (this.statuses.get(plugin.id)?.state !== 'running') throw Error(`Could not start ${plugin.name}`);
                    this.memberStarted?.(plugin.id);
                }
                this.publishService(base);
                this.patch(recipeId, { state: 'running' });
            } catch (error) {
                this.withdrawService(recipeId);
                this.patch(recipeId, { state: 'error', lastError: errorMessage(error, 'Service start failed') });
            }
            return;
        }
		if (!mode) {
			this.patch(recipeId, {
				state: 'error',
				lastError: 'No install mode selected',
			});
			return;
		}

		if (
			status?.state === 'running' &&
			(mode === 'connect' ||
				(await processSupervisorService.isRunning(recipeId)))
		)
			return;

		try {
			let existingContainer: ExistingContainerState = 'absent';
			if (mode === 'docker') {
				existingContainer = await this.inspectContainer(recipeId);
				if (existingContainer === 'running') {
					// The daemon was restarted, but its container survived. Reuse it.
					this.reattached.add(recipeId);
					if (status?.state !== 'running') {
						await this.adoptContainerPort(base);
						this.patch(recipeId, { state: 'running', lastError: null });
						this.runStartHook(await this.resolveForCurrentPlatform(base));
					}
					return;
				}
			}

			this.reattached.delete(recipeId);
			this.patch(recipeId, { state: 'starting', lastError: null });
			if (existingContainer === 'stopped') {
				await this.adoptContainerPort(base);
			} else if (mode !== 'connect') {
				await this.allocatePorts(base);
			}
			const recipe = await this.resolveForCurrentPlatform(base);
            if (recipe.type === ENDPOINT_TYPE && !readEndpointTransport(recipe, getInstanceId())) throw Error('Invalid endpoint protocol or WebSocket URL');
			const workdir = (await materializeRecipeFiles(recipe)) ?? undefined;

			if (mode === 'connect') {
				this.patch(recipeId, { state: 'running', lastError: null });
				this.runStartHook(recipe);
				return;
			}

			if (mode === 'system') {
				const system = findMode(recipe, 'system');
				if (!system) throw new Error('System mode not supported');
				await processSupervisorService.spawn(recipeId, {
					command: system.runCommand.command,
					args: system.runCommand.args,
					env: recipe.env,
					cwd: recipe.cwd ?? workdir,
				});
			} else if (mode === 'docker') {
				const docker = findMode(recipe, 'docker');
				if (!docker) throw new Error('Container mode not supported');
				const containerEngine = this.containerEngineForRuntime(recipeId);
				await this.verifyStorageVolumes(recipe, containerEngine, false);
				await processSupervisorService.spawn(recipeId, {
					command: containerEngine,
					args:
						existingContainer === 'stopped'
							? ['start', '--attach', containerName(recipeId)]
							: [
								'run',
								'--rm',
								'--name',
								containerName(recipeId),
								...dockerVolumeArgs(recipeId, docker.volumes),
								...docker.runArgs,
								docker.image,
								...(docker.command ?? []),
							],
					env:
						containerEngine === 'podman'
							? await this.podmanRegistryEnv(recipe.env)
							: recipe.env,
					cwd: recipe.cwd,
				});
			}

			this.patch(recipeId, { state: 'running', lastError: null });
			this.runStartHook(recipe);
		} catch (error) {
			const message = errorMessage(error, 'failed to start');
			this.patch(recipeId, { state: 'error', lastError: message });
		}
	}

	async stop(recipeId: string): Promise<void> {
		// A stop racing with a pending start must win, not leave a late container behind.
		await this.starting.get(recipeId);
        if (this.recipes.get(recipeId)?.type === SERVICE_TYPE) {
            await this.installing.get(recipeId);
            this.withdrawService(recipeId);
            this.remoteChecks.delete(recipeId);
            this.patch(recipeId, { state: this.readInstalled().has(recipeId) ? 'stopped' : 'not-installed', lastError: null });
            return;
        }
		this.reattached.delete(recipeId);

		const recipe = this.recipes.get(recipeId);
		const mode = this.statuses.get(recipeId)?.mode;
		this.patch(recipeId, { state: 'stopping' });

		try {
			if (mode === 'docker') {
				await processSupervisorService.runCommand(`${recipeId}-stop`, {
					command: this.containerEngineForRuntime(recipeId),
					args: ['stop', containerName(recipeId)],
					env: {},
				});
			}
			await processSupervisorService.stop(recipeId);
			if (
				mode === 'docker' &&
				(await this.inspectContainer(recipeId)) === 'running'
			) {
				throw new Error(
					`Container "${containerName(recipeId)}" is still running; recipe was not stopped`,
				);
			}
			this.patch(recipeId, { state: 'stopped', lastError: null });
			if (recipe) this.runStopHook(recipe);
			this.ports.delete(recipeId);
		} catch (error) {
			const message = errorMessage(error, 'failed to stop');
			this.patch(recipeId, { state: 'error', lastError: message });
			throw error;
		}
	}

	async setVariables(
		recipeId: string,
		values: Record<string, string>,
	): Promise<void> {
		const recipe = this.recipes.get(recipeId);
		if (!recipe) return;

		this.recipes.set(recipeId, { ...recipe, variableValues: values });

		await this.persistUserRecipes();
		this.emit();
	}

	getContainerEngineOverride(recipeId: string): ContainerEngine | null {
		return this.readContainerEngineOverrides().get(recipeId) ?? null;
	}

	setContainerEngineOverride(
		recipeId: string,
		engine: ContainerEngine | null,
	): void {
		const map = this.readContainerEngineOverrides();
		if (engine) map.set(recipeId, engine);
		else map.delete(recipeId);
		localStorage.setItem(
			CONTAINER_ENGINES_KEY,
			JSON.stringify(Object.fromEntries(map)),
		);
	}

	async installFromRegistry(
		entry: RegistryEntry,
		version?: string,
	): Promise<Recipe> {
		const recipe = await recipeRegistry.fetchRecipe(entry, version);
		if (
			recipe.id !== entry.id ||
			recipe.type !== entry.type ||
			!pluginTypeRegistry.get(recipe.type) ||
			!Array.isArray(recipe.modes) ||
			!recipe.env ||
			!recipe.typeConfig ||
			(version && recipe.version !== version)
		) {
			throw new Error(
				'Registry recipe manifest is invalid or does not match the selected entry',
			);
		}
		return this.save(recipe);
	}

	async uninstall(recipeId: string): Promise<void> {
        if (this.recipes.get(recipeId)?.type === SERVICE_TYPE) {
            await this.stop(recipeId);
            this.setInstalled(recipeId, null);
            this.patch(recipeId, { state: 'not-installed', mode: null });
            return;
        }
		const status = this.statuses.get(recipeId);
		const mode = status?.mode;

		if (!mode || mode === 'connect') {
            if (this.recipes.get(recipeId)?.type === ENDPOINT_TYPE) await this.stop(recipeId);
			this.setInstalled(recipeId, null);
			this.patch(recipeId, { state: 'not-installed', mode: null });
			return;
		}

		if (status?.state === 'running') {
			await this.stop(recipeId).catch(() => undefined);
		}

		const base = this.recipes.get(recipeId);
		if (!base) return;

		const recipe = await this.resolveForCurrentPlatform(base);

		this.patch(recipeId, { state: 'installing', lastError: null });

		try {
			if (mode === 'docker') {
				const docker = findMode(recipe, 'docker');
				const containerEngine = this.containerEngineForRuntime(recipeId);

				await processSupervisorService
					.runCommand(`${recipeId}-rm`, {
						command: containerEngine,
						args: ['rm', '-f', containerName(recipeId)],
						env: {},
					})
					.catch(() => undefined);

				if (docker?.image && docker.removeImageOnUninstall) {
					await processSupervisorService.runCommand(`${recipeId}-rmi`, {
						command: containerEngine,
						args: ['rmi', '-f', docker.image],
						env: {},
					});
				}
			} else if (mode === 'system') {
				const system = findMode(recipe, 'system');

				if (system?.uninstallSteps?.length) {
					await this.runSteps(recipe, system.uninstallSteps);
				}
			}

			this.setInstalled(recipeId, null);
			this.patch(recipeId, { state: 'not-installed', mode: null });
		} catch (error) {
			const message = errorMessage(error, 'uninstall failed');
			this.patch(recipeId, { state: 'error', lastError: message });
		}
	}

	checkForUpdates(entries: RegistryEntry[]): Map<string, string> {
		const installed = this.readInstalled();
		const updates = new Map<string, string>();

		for (const recipe of this.recipes.values()) {
			if (recipe.source !== 'registry') continue;

			const record = installed.get(recipe.id);
			if (!record) continue;

			const entry = entries.find((e) => e.id === recipe.id);
			const latest = entry?.versions?.[0]?.version ?? entry?.version;
			const current = record.version ?? recipe.version;

			if (latest && current && latest !== current) {
				updates.set(recipe.id, latest);
			}
		}

		return updates;
	}

	private async reattachDockerRecipes(running: Set<string>): Promise<void> {
		for (const recipe of this.recipes.values()) {
			if (running.has(recipe.id)) continue;

			const status = this.statuses.get(recipe.id);

			if (status?.mode !== 'docker' || status.state === 'not-installed') {
				continue;
			}

			const alive = await this.isContainerRunning(recipe.id);
			if (!alive) continue;

			this.reattached.add(recipe.id);
			await this.adoptContainerPort(recipe);

			this.statuses.set(recipe.id, {
				...status,
				state: 'running',
				lastError: null,
			});

			this.runStartHook(await this.resolveForCurrentPlatform(recipe));
		}
	}

	private async isContainerRunning(recipeId: string): Promise<boolean> {
		try {
			return (await this.inspectContainer(recipeId)) === 'running';
		} catch (error) {
			this.appendLog(
				recipeId,
				`Container inspection failed: ${errorMessage(error, 'unknown error')}`,
			);
			return false;
		}
	}

	private async inspectContainer(
		recipeId: string,
	): Promise<ExistingContainerState> {
		const name = containerName(recipeId);
		const handleId = `${recipeId}-inspect-${nanoid(6)}`;
		const lines: string[] = [];
		const unsubscribe = processSupervisorService.onOutput((event) => {
			if (event.handleId === handleId) lines.push(event.line);
		});
		try {
			const code = await processSupervisorService.runCommand(handleId, {
				command: this.containerEngineForRuntime(recipeId),
				args: ['container', 'inspect', '--format', '{{.State.Status}}', name],
				env: {},
			});
			return containerStateFromInspect(code, lines, name);
		} finally {
			unsubscribe();
		}
	}

	private async runSteps(
		recipe: Recipe,
		steps: InstallStep[],
		cwd?: string,
		containerEngine?: ContainerEngine,
	): Promise<void> {
		for (const step of steps) {
			if (this.cancelling.has(recipe.id)) {
				throw new Error('Install cancelled');
			}

			const command =
				containerEngine && step.command === 'docker'
					? containerEngine
					: step.command;
			this.appendLog(recipe.id, `$ ${command} ${step.args.join(' ')}`);

			let code: number;
			try {
				code = await processSupervisorService.runCommand(recipe.id, {
					command,
					args: step.args,
					env:
						containerEngine === 'podman' && step.command === 'docker'
							? await this.podmanRegistryEnv(recipe.env)
							: recipe.env,
					cwd: recipe.cwd ?? cwd,
				});
			} catch (error) {
				throw new Error(
					`"${step.label}" failed: ${errorMessage(error, 'could not start command')}`,
				);
			}

			if (this.cancelling.has(recipe.id)) {
				throw new Error('Install cancelled');
			}

			if (code !== 0) {
				throw new Error(`"${step.label}" exited with code ${code}`);
			}
		}
	}

	private async podmanRegistryEnv(
		env: Record<string, string>,
	): Promise<Record<string, string>> {
		const registries = String(
			getStoredSetting<string>('podmanUnqualifiedSearchRegistries') ?? '',
		)
			.split(',')
			.map((registry) => registry.trim())
			.filter(Boolean);
		if (registries.length === 0) return env;

		const path = await invoke<string>('path_join', {
			parts: [await appDataDir(), 'podman-registries.conf'],
		});
		const contents = Array.from(
			new TextEncoder().encode(
				`unqualified-search-registries = ${JSON.stringify(registries)}\n`,
			),
		);

		await invoke('fs_write', { path, contents });
		return { ...env, CONTAINERS_REGISTRIES_CONF: path };
	}

	private containerEngineForInstall(recipeId: string): ContainerEngine {
		const override = this.getContainerEngineOverride(recipeId);
		if (override) return override;
		return getStoredSetting<ContainerEngine>('defaultContainerEngine') ===
			'podman'
			? 'podman'
			: 'docker';
	}

	private containerEngineForRuntime(recipeId: string): ContainerEngine {
		const record = this.readInstalled().get(recipeId);
		if (record?.mode === 'docker') return record.containerEngine ?? 'docker';
		return this.containerEngineForInstall(recipeId);
	}

	private readContainerEngineOverrides(): Map<string, ContainerEngine> {
		try {
			const raw = localStorage.getItem(CONTAINER_ENGINES_KEY);
			return new Map(raw ? Object.entries(JSON.parse(raw)) : []);
		} catch {
			return new Map();
		}
	}

	private runStartHook(recipe: Recipe): void {
		try {
			pluginTypeRegistry.get(recipe.type)?.onStart?.(recipe);
		} catch (error) {
			console.error('[RecipeManager] onStart hook failed:', error);
		}
	}

	private runStopHook(recipe: Recipe): void {
		try {
			pluginTypeRegistry.get(recipe.type)?.onStop?.(recipe);
		} catch (error) {
			console.error('[RecipeManager] onStop hook failed:', error);
		}
	}

	private appendLog(recipeId: string, line: string): void {
		const current = this.statuses.get(recipeId);
		if (!current) return;

		const logTail = [...current.logTail, line].slice(-LOG_TAIL_LIMIT);

		this.patch(recipeId, { logTail });
	}

	private patch(recipeId: string, patch: Partial<RecipeStatus>): void {
		const current = this.statuses.get(recipeId);
		if (!current) return;

		this.statuses.set(recipeId, { ...current, ...patch });
		this.emit();
	}

	private emit(): void {
		const snapshot = new Map(this.statuses);
		for (const listener of this.listeners) listener(snapshot);
	}

    private async persistUserRecipes(): Promise<void> {
        const write = this.persistQueue.catch(() => undefined).then(async () => {
            const seedIds = new Set(pluginTypeRegistry.seeds().map(r => r.id));
            await recipeStore.save(this.listRecipes().filter(r => !seedIds.has(r.id) && r.source !== 'seed'));
        });
        this.persistQueue = write;
        await write;
    }

	private readInstalled(): Map<string, InstalledRecord> {
		try {
			const raw = localStorage.getItem(INSTALLED_KEY);
			return new Map(raw ? Object.entries(JSON.parse(raw)) : []);
		} catch {
			return new Map();
		}
	}

	private setInstalled(recipeId: string, record: InstalledRecord | null): void {
		const map = this.readInstalled();

		if (record) map.set(recipeId, record);
		else map.delete(recipeId);

		localStorage.setItem(
			INSTALLED_KEY,
			JSON.stringify(Object.fromEntries(map)),
		);
	}
}

export const recipeManager = new RecipeManager();
