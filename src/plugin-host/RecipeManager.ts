// src/plugin-host/RecipeManager.ts
import { nanoid } from 'nanoid';

import { applyPlatform, detectPlatform } from './platformResolution';
import { pluginTypeRegistry } from './PluginTypeRegistry';
import { processSupervisorService } from './ProcessSupervisorService';
import { recipeRegistry } from './RecipeRegistry';
import { recipeStore } from './RecipeStore';
import { effectiveValues, resolveRecipe } from './variableResolution';
import { invoke } from '@tauri-apps/api/core';
import { getStoredSetting } from '../config';
import { appDataDir } from '@tauri-apps/api/path';
import { routeEndpoint } from './traefikRoutes';
import { materializeRecipeFiles } from './recipeWorkdir';
import {
	findMode,
	type InstallModeKind,
	type InstallStep,
	type PlatformId,
	type Recipe,
	type RecipeStatus,
	type RegistryEntry,
} from './types';

const LOG_TAIL_LIMIT = 200;
const INSTALLED_KEY = 'chelys-installed-recipes';

type StatusListener = (statuses: Map<string, RecipeStatus>) => void;

interface InstalledRecord {
	mode: InstallModeKind;
	version?: string;
}

const containerName = (recipeId: string): string =>
	`chelys-${recipeId}`.replace(/[^a-zA-Z0-9_.-]/g, '-');

class RecipeManager {
	private recipes = new Map<string, Recipe>();
	private statuses = new Map<string, RecipeStatus>();
	private listeners = new Set<StatusListener>();
	private initialized = false;
	private platform: PlatformId = 'desktop';
	private reattached = new Set<string>();
	private cancelling = new Set<string>();
	private ports = new Map<string, Record<string, string>>();

	async reinjectRunning(): Promise<void> {
		if (!this.initialized) return;

		for (const [id, status] of this.statuses) {
			if (status.state !== 'running') continue;

			const base = this.recipes.get(id);
			if (!base) continue;

			this.runStartHook(await this.resolveForCurrentPlatform(base));
		}
	}

	private async resolveForCurrentPlatform(base: Recipe): Promise<Recipe> {
		this.platform = await detectPlatform();

		const pinned = this.ports.get(base.id);
		const source = pinned ? { ...base, variableValues: pinned } : base;

		const resolved = resolveRecipe(applyPlatform(source, this.platform));
		return this.expandRuntimeTokens(resolved);
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
				command: 'docker',
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
			byId.set(recipe.id, recipe);
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

	getStatus(recipeId: string): RecipeStatus | undefined {
		return this.statuses.get(recipeId);
	}

	subscribe(listener: StatusListener): () => void {
		this.listeners.add(listener);
		listener(new Map(this.statuses));
		return () => this.listeners.delete(listener);
	}

	async save(recipe: Recipe): Promise<Recipe> {
		const id = recipe.id || nanoid();
		const stored: Recipe = { ...recipe, id };

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
		await this.stop(recipeId).catch(() => undefined);

		this.recipes.delete(recipeId);
		this.statuses.delete(recipeId);
		this.setInstalled(recipeId, null);

		await this.persistUserRecipes();
		this.emit();
	}

	async cancelInstall(recipeId: string): Promise<void> {
		this.cancelling.add(recipeId);
		await processSupervisorService.stop(recipeId);
	}

	async install(recipeId: string, mode: InstallModeKind): Promise<void> {
		const base = this.recipes.get(recipeId);
		if (!base) return;

		const recipe = await this.resolveForCurrentPlatform(base);

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
				if (!docker) throw new Error('Docker mode not supported');

				await this.runSteps(recipe, docker.buildSteps, workdir);
			} else if (mode === 'connect') {
				// Nothing to install for connect mode.
			}

			this.setInstalled(recipeId, {
				mode,
				version: this.recipes.get(recipeId)?.version,
			});

			this.patch(recipeId, { state: 'installed' });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'install failed';
			this.appendLog(recipeId, `Install failed: ${message}`);
			this.patch(recipeId, { state: 'error', lastError: message });
		} finally {
			this.cancelling.delete(recipeId);
		}
	}

	async run(recipeId: string): Promise<void> {
		this.reattached.delete(recipeId);

		const base = this.recipes.get(recipeId);
		if (!base) return;

		const mode = this.statuses.get(recipeId)?.mode;

		if (!mode) {
			this.patch(recipeId, {
				state: 'error',
				lastError: 'No install mode selected',
			});
			return;
		}

		if (mode !== 'connect') await this.allocatePorts(base);

		const recipe = await this.resolveForCurrentPlatform(base);

		this.patch(recipeId, { state: 'starting', lastError: null });

		try {
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
				if (!docker) throw new Error('Docker mode not supported');

				await processSupervisorService.spawn(recipeId, {
					command: 'docker',
					args: [
						'run',
						'--rm',
						'--name',
						containerName(recipeId),
						...docker.runArgs,
						docker.image,
						...(docker.command ?? []),
					],
					env: recipe.env,
					cwd: recipe.cwd,
				});
			}

			this.patch(recipeId, { state: 'running', lastError: null });
			this.runStartHook(recipe);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'failed to start';
			this.patch(recipeId, { state: 'error', lastError: message });
		}
	}

	async stop(recipeId: string): Promise<void> {
		this.reattached.delete(recipeId);

		const recipe = this.recipes.get(recipeId);
		const mode = this.statuses.get(recipeId)?.mode;

		this.patch(recipeId, { state: 'stopping' });

		if (mode === 'docker') {
			await processSupervisorService
				.runCommand(`${recipeId}-stop`, {
					command: 'docker',
					args: ['stop', containerName(recipeId)],
					env: {},
				})
				.catch(() => undefined);
		}

		await processSupervisorService.stop(recipeId);

		this.patch(recipeId, { state: 'stopped' });

		if (recipe) this.runStopHook(recipe);

		this.ports.delete(recipeId);
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

	async installFromRegistry(
		entry: RegistryEntry,
		version?: string,
	): Promise<Recipe> {
		const recipe = await recipeRegistry.fetchRecipe(entry, version);
		return this.save(recipe);
	}

	async uninstall(recipeId: string): Promise<void> {
		const status = this.statuses.get(recipeId);
		const mode = status?.mode;

		if (!mode || mode === 'connect') {
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

				await processSupervisorService
					.runCommand(`${recipeId}-rm`, {
						command: 'docker',
						args: ['rm', '-f', containerName(recipeId)],
						env: {},
					})
					.catch(() => undefined);

				if (docker?.image) {
					await processSupervisorService.runCommand(`${recipeId}-rmi`, {
						command: 'docker',
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
			const message =
				error instanceof Error ? error.message : 'uninstall failed';
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
			const out: string[] = [];

			const unsubscribe = processSupervisorService.onOutput(
				({ handleId, line }) => {
					if (handleId === `${recipeId}-probe`) out.push(line);
				},
			);

			const code = await processSupervisorService.runCommand(
				`${recipeId}-probe`,
				{
					command: 'docker',
					args: [
						'ps',
						'--filter',
						`name=^/${containerName(recipeId)}$`,
						'--format',
						'{{.Names}}',
					],
					env: {},
				},
			);

			unsubscribe();

			return (
				code === 0 && out.some((l) => l.trim() === containerName(recipeId))
			);
		} catch {
			return false;
		}
	}

	private async runSteps(
		recipe: Recipe,
		steps: InstallStep[],
		cwd?: string,
	): Promise<void> {
		for (const step of steps) {
			if (this.cancelling.has(recipe.id)) {
				throw new Error('Install cancelled');
			}

			this.appendLog(recipe.id, `$ ${step.command} ${step.args.join(' ')}`);

			const code = await processSupervisorService.runCommand(recipe.id, {
				command: step.command,
				args: step.args,
				env: recipe.env,
				cwd: recipe.cwd ?? cwd,
			});

			if (this.cancelling.has(recipe.id)) {
				throw new Error('Install cancelled');
			}

			if (code !== 0) {
				throw new Error(`"${step.label}" exited with code ${code}`);
			}
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
		const seedIds = new Set(pluginTypeRegistry.seeds().map((r) => r.id));

		const userRecipes = this.listRecipes().filter(
			(r) => !seedIds.has(r.id) && r.source !== 'seed',
		);

		await recipeStore.save(userRecipes);
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
