// src/control/commands.ts
import { getActiveAccountId } from '../plugin-host/activeAccount';
import { recipeManager } from '../plugin-host/RecipeManager';
import { recipeRegistry } from '../plugin-host/RecipeRegistry';
import { pluginTypeRegistry } from '../plugin-host/PluginTypeRegistry';
import {
	detectActualPlatform,
	detectArch,
} from '../plugin-host/platformResolution';
import { accessPolicy, type Permission, type RequestOrigin } from './policy';
import { accountStores, STORE_NAMES, type StoreName } from './stores';
import { chelysSettings } from './settings';
import { getPlainSecret, setPlainSecret } from './secrets';
import type {
	Recipe,
	RecipeStatus,
	InstallModeKind,
	DockerInstallSource,
} from '../plugin-host/types';
import {
	listAvailablePeers,
	listAccountCollaborators,
	connectedTexlyrePeers,
	addPeerEndpoint,
	removePeerEndpoint,
	callRemotePeer,
} from './client';
import { inspectionSharing } from './sharing';
import { getInstanceId } from './protocol';
import { rendezvousPresence } from '../peer/RendezvousPresence';

export interface CommandRequest {
	method: string;
	params?: Record<string, unknown>;
}
export interface AccountHandlers {
	login?(credentials: {
		username: string;
		password: string;
		prf_output_hex: string;
	}): Promise<unknown>;
	logout?(): Promise<unknown>;
	status?(): unknown;
	credentials?(): { username: string; prf_output_hex: string } | null;
	password?(): string | null;
	update?(changes: {
		username?: string;
		password?: string;
		prf_output_hex?: string;
	}): Promise<unknown>;
}
const PERMISSION_BY_METHOD: Record<string, Permission> = {
	'instance.inspect': 'inventory.read',
	'machine.inspect': 'machine.read',
	'recipes.list': 'recipes.read',
	'recipes.inspect': 'recipes.read',
	'recipes.logs': 'recipes.logs',
	'recipes.metrics': 'recipes.telemetry.read',
	'recipes.run': 'recipes.run',
	'recipes.stop': 'recipes.run',
	'recipes.restart': 'recipes.run',
	'recipes.install': 'recipes.install',
	'recipes.uninstall': 'recipes.install',
	'recipes.import': 'recipes.edit',
	'recipes.set': 'recipes.edit',
	'recipes.env.set': 'recipes.edit',
	'recipes.env.delete': 'recipes.edit',
	'recipes.env.list': 'recipes.read',
	'recipes.env.get': 'recipes.edit',
	'recipes.registry.list': 'recipes.read',
	'recipes.registry.add': 'recipes.edit',
	'recipes.remove': 'recipes.remove',
	'profile.show': 'instance.profile.read',
	'profile.set': 'instance.profile.edit',
	'chelys.settings.list': 'chelys.settings.read',
	'chelys.settings.get': 'chelys.settings.read',
	'chelys.settings.set': 'chelys.settings.write',
	'chelys.settings.delete': 'chelys.settings.write',
};
const deniedRemote = new Error('This operation is local only');

function requiredPermission(
	method: string,
	params: Record<string, unknown>,
): Permission | null {
	const fixed = PERMISSION_BY_METHOD[method];
	if (fixed) return fixed;
	if (method === 'account.secret.get') return 'texlyre.secrets.read';
	if (method === 'account.secret.set') return 'texlyre.secrets.write';
	if (method.startsWith('account.store.')) {
		if (
			typeof params.store !== 'string' ||
			!STORE_NAMES.includes(params.store as StoreName)
		) {
			throw new Error('Unknown account store');
		}
		const action = method.slice('account.store.'.length);
		if (action === 'list' || action === 'get')
			return `texlyre.${params.store}.read` as Permission;
		if (
			action === 'set' ||
			action === 'delete' ||
			(params.store === 'records' &&
				(action === 'append' || action === 'removeEntry'))
		)
			return `texlyre.${params.store}.write` as Permission;
	}
	return null;
}
const asString = (value: unknown, name: string): string => {
	if (typeof value !== 'string' || !value.trim())
		throw new Error(`${name} is required`);
	return value;
};
const asObject = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('JSON object required');
	return value as Record<string, unknown>;
};
function statusForRecipe(recipe: Recipe): RecipeStatus {
	return (
		recipeManager.getStatus(recipe.id) ?? {
			recipeId: recipe.id,
			state: 'not-installed',
			mode: null,
			logTail: [],
			lastError: null,
		}
	);
}
function readonlyRecipe(recipe: Recipe): Record<string, unknown> {
	const status = statusForRecipe(recipe);
	const inspection = pluginTypeRegistry
		.get(recipe.type)
		?.inspectRecipe?.(recipe, status);
	return {
		id: recipe.id,
		name: recipe.name,
		type: recipe.type,
		version: recipe.version,
		modes: recipe.modes.map((mode) => mode.kind),
		inspectable: Boolean(inspection),
		inspectionFields: inspection?.fields ?? [],
		state: status?.state ?? 'not-installed',
		mode: status?.mode ?? null,
	};
}

function serializeRecipe(
	recipe: Recipe,
	remote: boolean,
): Record<string, unknown> {
	return remote
		? readonlyRecipe(recipe)
		: (recipe as unknown as Record<string, unknown>);
}
function copy(value: Recipe): Recipe {
	return structuredClone(value);
}
function safeStatus(id: string, remote: boolean): unknown {
	const status = recipeManager.getStatus(id);
	return remote && status ? { state: status.state, mode: status.mode } : status;
}
function recipeById(id: string): Recipe {
	const recipe = recipeManager.listRecipes().find((item) => item.id === id);
	if (!recipe) throw new Error(`Unknown recipe: ${id}`);
	return recipe;
}
function success(id: string): void {
	const state = recipeManager.getStatus(id);
	if (state?.state === 'error')
		throw new Error(state.lastError ?? 'Recipe failed');
}
function storageAccount(): string {
	const id = getActiveAccountId();
	if (!id) throw new Error('Login required');
	return id;
}
function profile() {
	const account = storageAccount();
	const name = localStorage.getItem('chelys-instance-name') || 'Chelys';
	return {
		accountId: account,
		name,
		instanceId: getInstanceId(),
		accessMode: accessPolicy.mode(),
	};
}
function mutateRecipe(
	recipe: Recipe,
	field: string,
	value: unknown,
	remove = false,
): Recipe {
	const updated = copy(recipe);
	const parts = field.split('.');
	if (
		parts.some(
			(key) => !key || ['__proto__', 'constructor', 'prototype'].includes(key),
		)
	)
		throw new Error('Invalid field path');
	if (['id', 'source', 'type', 'modes'].includes(parts[0]))
		throw new Error('Immutable or managed recipe field');
	if (parts.length === 1) {
		if (!['name', 'notes', 'cwd', 'backend'].includes(field))
			throw new Error('Unsupported recipe field');
		if (!remove && typeof value !== 'string')
			throw new Error('String expected');
		if (field === 'name' && (remove || !String(value).trim()))
			throw new Error('Recipe name required');
		(updated as unknown as Record<string, unknown>)[field] = remove
			? undefined
			: value;
		return updated;
	}
	if (
		!['typeConfig', 'env', 'variableValues'].includes(parts[0]) ||
		parts.length !== 2
	) {
		throw new Error(
			'Use name, notes, cwd, backend or typeConfig.KEY, env.KEY, variableValues.KEY',
		);
	}
	if (parts[0] !== 'typeConfig' && !remove && typeof value !== 'string')
		throw new Error('String value expected');
	const base = updated as unknown as Record<string, any>;
	base[parts[0]] = { ...(base[parts[0]] ?? {}) };
	if (remove) delete base[parts[0]][parts[1]];
	else base[parts[0]][parts[1]] = value;
	return updated;
}

export class ChelysControl {
	private runtimeKind: 'desktop' | 'headless' = 'desktop';
	private runtimePid: number | null = null;
	private storageSeedAllowed = false;
	private account: AccountHandlers = {};
	private machineInfo: (() => Promise<Record<string, unknown>>) | null = null;
	private onRecipeCommand: ((method: string, id: string) => void) | null = null;

	setStorageSeedAllowed(value: boolean): void {
		this.storageSeedAllowed = value;
	}
	setRuntimeKind(
		kind: 'desktop' | 'headless',
		pid: number | null = null,
	): void {
		this.runtimeKind = kind;
		this.runtimePid = pid;
	}
	setAccountHandlers(handlers: AccountHandlers): void {
		this.account = handlers;
	}
	setMachineInfo(handler: () => Promise<Record<string, unknown>>): void {
		this.machineInfo = handler;
	}
	setRecipeCommandListener(
		listener: (method: string, id: string) => void,
	): void {
		this.onRecipeCommand = listener;
	}
	private notifyRecipe(method: string, id: string): void {
		if (
			['recipes.stop', 'recipes.uninstall', 'recipes.remove'].includes(method)
		)
			rendezvousPresence.stop(id);
		this.onRecipeCommand?.(method, id);
	}

	async execute(
		request: CommandRequest,
		origin: RequestOrigin = { transport: 'local' },
	): Promise<unknown> {
		if (
			!request ||
			typeof request.method !== 'string' ||
			request.method.length > 100
		)
			throw new Error('Invalid command');
		const method = request.method;
		const p = request.params ?? {};
		if (!p || typeof p !== 'object' || Array.isArray(p))
			throw new Error('Command parameters must be an object');
		const remote = origin.transport !== 'local';
		if (remote) {
			const managed = new Set([
				'recipes.install',
				'recipes.uninstall',
				'recipes.run',
				'recipes.stop',
				'recipes.restart',
				'recipes.remove',
				'recipes.set',
				'recipes.env.set',
				'recipes.env.delete',
				'recipes.env.get',
			]);
			const selectedRecipe =
				typeof p.id === 'string'
					? recipeManager.listRecipes().find((r) => r.id === p.id)
					: null;
			const changingInfrastructure =
				(method === 'recipes.import' &&
					(p.recipe as Recipe | undefined)?.type === 'infrastructure') ||
				(selectedRecipe?.type === 'infrastructure' && managed.has(method));
			if (changingInfrastructure)
				await accessPolicy.authorize(origin, 'infrastructure.manage');
			if (
				method === 'recipes.logs' &&
				selectedRecipe?.type === 'infrastructure'
			) {
				await accessPolicy.authorize(origin, 'infrastructure.logs');
			}
			const permission = requiredPermission(method, p);
			if (!permission) throw deniedRemote;
			await accessPolicy.authorize(origin, permission);
		}
		const id = () => asString(p.id, 'Recipe ID');
		const key = () => asString(p.key, 'Key');
		const registerRecipe = async (): Promise<Recipe> => {
			const recipeId = id();
			const version =
				p.version === undefined ? undefined : asString(p.version, 'Version');
			const existing = recipeManager
				.listRecipes()
				.find((recipe) => recipe.id === recipeId);
			if (existing) {
				if (version && existing.version !== version)
					throw new Error(
						`Recipe already registered with version ${existing.version ?? 'unknown'}`,
					);
				return existing;
			}
			const entry = (await recipeRegistry.list(false)).find(
				(recipe) => recipe.id === recipeId,
			);
			if (!entry)
				throw new Error(`Recipe not found in configured registry: ${recipeId}`);
			if (remote) {
				if (method === 'recipes.install')
					await accessPolicy.authorize(origin, 'recipes.edit');
				if (entry.type === 'infrastructure')
					await accessPolicy.authorize(origin, 'infrastructure.manage');
			}
			return recipeManager.installFromRegistry(entry, version);
		};
		switch (method) {
			// The desktop UI and CLI use the same local-only command dispatcher.
			// These rich commands are deliberately not granted to remote API keys.
			case 'storage.sync': {
				const browser = asObject(p.browser ?? {});
				if (this.storageSeedAllowed && p.seed === true) {
					for (const [name, value] of Object.entries(browser)) {
						if (
							typeof value === 'string' &&
							!['__proto__', 'prototype', 'constructor'].includes(name) &&
							localStorage.getItem(name) === null
						)
							localStorage.setItem(name, value);
					}
				}
				this.storageSeedAllowed = false;
				return Object.fromEntries(
					Array.from({ length: localStorage.length }, (_, index) => {
						const name = localStorage.key(index) ?? '';
						return [name, localStorage.getItem(name) ?? ''];
					}),
				);
			}
			case 'storage.mutate': {
				const operation = asString(p.operation, 'Operation');
				if (operation === 'clear') localStorage.clear();
				else {
					const name = key();
					if (['__proto__', 'prototype', 'constructor'].includes(name))
						throw new Error('Invalid storage key');
					if (operation === 'set')
						localStorage.setItem(name, String(p.value ?? ''));
					else if (operation === 'delete') localStorage.removeItem(name);
					else throw new Error('Unknown storage operation');
					const accountId = getActiveAccountId();
					if (accountId && name.startsWith(`texlyre-user-${accountId}-`)) {
						const store = name.slice(`texlyre-user-${accountId}-`.length);
						if (STORE_NAMES.includes(store as StoreName))
							accountStores.publish(store as StoreName);
					}
				}
				return { updated: true };
			}
			case 'recipes.collaborators': {
				const recipe = recipeById(id());
				return rendezvousPresence.list(
					recipe,
					recipeManager.getStatus(recipe.id)?.state === 'running',
				);
			}
			case 'recipes.snapshot':
				return {
					recipes: recipeManager.listRecipes(),
					statuses: Object.fromEntries(
						recipeManager
							.listRecipes()
							.map((recipe) => [recipe.id, statusForRecipe(recipe)]),
					),
					engines: Object.fromEntries(
						recipeManager
							.listRecipes()
							.map((recipe) => [
								recipe.id,
								recipeManager.getContainerEngineOverride(recipe.id),
							]),
					),
				};
			case 'recipes.save': {
				const recipe = asObject(p.recipe) as unknown as Recipe;
				if (
					typeof recipe.id !== 'string' ||
					(recipe.id !== '' && !/^[a-zA-Z0-9_.-]{1,128}$/.test(recipe.id)) ||
					typeof recipe.type !== 'string' ||
					!pluginTypeRegistry.get(recipe.type) ||
					!Array.isArray(recipe.modes) ||
					!recipe.env ||
					typeof recipe.env !== 'object' ||
					!recipe.typeConfig ||
					typeof recipe.typeConfig !== 'object'
				)
					throw new Error('Invalid recipe');
				return recipeManager.save(recipe);
			}
			case 'recipes.variables.set': {
				const values = asObject(p.values);
				if (Object.values(values).some((value) => typeof value !== 'string'))
					throw new Error('Variables must be strings');
				await recipeManager.setVariables(
					id(),
					values as Record<string, string>,
				);
				return { updated: true };
			}
			case 'recipes.engine.set': {
				if (p.engine !== null && p.engine !== 'docker' && p.engine !== 'podman')
					throw new Error('Unknown container engine');
				recipeById(id());
				recipeManager.setContainerEngineOverride(
					id(),
					p.engine as 'docker' | 'podman' | null,
				);
				return { updated: true };
			}
			case 'recipes.cancelInstall':
				await recipeManager.cancelInstall(id());
				return { cancelled: true };
			case 'recipes.reinject':
				await recipeManager.reinjectRunning();
				return { updated: true };
			case 'instance.runtime':
				return { kind: this.runtimeKind, pid: this.runtimePid };
			case 'peers.default': {
				const target = asString(p.target, 'Peer target');
				if (target === 'local') localStorage.removeItem('chelys-peer-default');
				else localStorage.setItem('chelys-peer-default', target);
				return { target };
			}
			case 'peers.default.get':
				return { target: localStorage.getItem('chelys-peer-default') };
			case 'peers.list':
				return listAvailablePeers();
			case 'peers.connect':
				addPeerEndpoint(
					asString(p.alias, 'Alias'),
					asString(p.url, 'WebSocket URL'),
				);
				return { connected: true };
			case 'peers.disconnect':
				removePeerEndpoint(asString(p.alias, 'Alias'));
				return { disconnected: true };
			case 'peers.call': {
				const method = asString(p.method, 'Remote method');
				if (method.startsWith('peers.'))
					throw new Error('Nested remote calls are unsupported');
				return callRemotePeer(
					asString(p.target, 'Peer target'),
					method,
					(p.params ?? {}) as Record<string, unknown>,
					typeof p.apiKey === 'string' ? p.apiKey : undefined,
				);
			}
			case 'instance.inspect': {
				let canInstallRecipes = !remote;
				let canRunRecipes = !remote;
				let canManageInfrastructure = !remote;
				if (remote) {
					canInstallRecipes = await accessPolicy
						.authorize(origin, 'recipes.install')
						.then(
							() => true,
							() => false,
						);
					canRunRecipes = await accessPolicy
						.authorize(origin, 'recipes.run')
						.then(
							() => true,
							() => false,
						);
					canManageInfrastructure = await accessPolicy
						.authorize(origin, 'infrastructure.manage')
						.then(
							() => true,
							() => false,
						);
				}
				let machine: Record<string, unknown> | null = null;
				if (
					!remote ||
					(await accessPolicy.authorize(origin, 'machine.read').then(
						() => true,
						() => false,
					))
				) {
					machine = this.machineInfo
						? await this.machineInfo()
						: {
								platform: await detectActualPlatform(),
								architecture: await detectArch(),
							};
				}
				return {
					instanceId: getInstanceId(),
					name: profile().name,
					machine,
					platform: machine?.platform ?? null,
					availableRecipes: recipeManager.listRecipes().map(readonlyRecipe),
					runningRecipes: recipeManager
						.listRecipes()
						.filter((r) => recipeManager.getStatus(r.id)?.state === 'running')
						.map(readonlyRecipe),
					capabilities: ['recipes', 'webrtc', 'websocket'],
					canInstallRecipes,
					canRunRecipes,
					canManageInfrastructure,
				};
			}
			case 'machine.inspect':
				return this.machineInfo
					? this.machineInfo()
					: {
							platform: await detectActualPlatform(),
							architecture: await detectArch(),
							availableStorageBytes: null,
							storageNote: 'Not available from the desktop runtime',
						};
			case 'chelys.settings.list':
				return chelysSettings.list();
			case 'chelys.settings.get':
				return chelysSettings.get(key());
			case 'chelys.settings.set':
				chelysSettings.set(key(), p.value);
				return { updated: true };
			case 'chelys.settings.delete':
				chelysSettings.delete(key());
				return { deleted: true };
			case 'account.status':
				return (
					this.account.status?.() ?? {
						loggedIn: Boolean(getActiveAccountId()),
						accountId: getActiveAccountId(),
					}
				);
			case 'account.credentials':
				return this.account.credentials?.() ?? null;
			case 'account.texlyre.peers':
				return connectedTexlyrePeers();
			case 'account.collaborators':
				return listAccountCollaborators();
			case 'account.login': {
				if (!this.account.login)
					throw new Error(
						'Account login is handled by the desktop account dialog',
					);
				return this.account.login({
					username: asString(p.username, 'Username'),
					password: asString(p.password, 'Password'),
					prf_output_hex: asString(p.prf_output_hex, 'PRF output'),
				});
			}
			case 'account.logout':
				return (
					this.account.logout?.() ??
					Promise.reject(
						new Error(
							'Account logout is handled by the desktop account dialog',
						),
					)
				);
			case 'account.secret.set': {
				const password = this.account.password?.();
				if (!password) throw new Error('Account password unavailable');
				await setPlainSecret(
					key(),
					asString(p.value, 'Secret value'),
					password,
				);
				return { stored: true };
			}
			case 'account.secret.get': {
				const password = this.account.password?.();
				if (!password) throw new Error('Account password unavailable');
				return getPlainSecret(key(), password);
			}
			case 'account.store.list':
				return accountStores.list(asString(p.store, 'Store') as StoreName);
			case 'account.store.get':
				return accountStores.get(
					asString(p.store, 'Store') as StoreName,
					key(),
				);
			case 'account.store.set':
				accountStores.set(
					asString(p.store, 'Store') as StoreName,
					key(),
					p.value,
				);
				return { updated: true };
			case 'account.store.delete':
				accountStores.delete(asString(p.store, 'Store') as StoreName, key());
				return { deleted: true };
			case 'account.store.append':
				if (p.store !== 'records')
					throw new Error('Append applies only to records');
				return accountStores.appendRecord(key(), p.value);
			case 'account.store.removeEntry':
				if (p.store !== 'records')
					throw new Error('Remove entry applies only to records');
				accountStores.removeRecord(key(), asString(p.recordId, 'Record ID'));
				return { removed: true };
			case 'profile.show':
				return profile();
			case 'profile.update': {
				if (!this.account.update) throw new Error('Account update unavailable');
				const changes = p as {
					username?: string;
					password?: string;
					prf_output_hex?: string;
				};
				if (
					Object.keys(changes).some(
						(k) => !['username', 'password', 'prf_output_hex'].includes(k),
					)
				)
					throw new Error('Invalid profile update field');
				return this.account.update(changes);
			}
			case 'profile.rotate-prf': {
				if (!this.account.update) throw new Error('Account update unavailable');
				const bytes = crypto.getRandomValues(new Uint8Array(32));
				const hex = Array.from(bytes, (b) =>
					b.toString(16).padStart(2, '0'),
				).join('');
				await this.account.update({ prf_output_hex: hex });
				return {
					prf_output_hex: hex,
					warning: 'This selects a new account room. Store the key securely.',
				};
			}
			case 'profile.set': {
				storageAccount();
				if (p.field !== 'name')
					throw new Error(
						'Only the instance display name can be set; change account identity with account.login',
					);
				localStorage.setItem('chelys-instance-name', asString(p.value, 'Name'));
				window.dispatchEvent(new Event('chelys-profile-changed'));
				return profile();
			}
			case 'access.show':
				return { mode: accessPolicy.mode(), keys: accessPolicy.listKeys() };
			case 'access.mode':
				accessPolicy.setMode(asString(p.mode, 'Mode') as any);
				return { mode: accessPolicy.mode() };
			case 'access.keys.list':
				return accessPolicy.listKeys();
			case 'access.keys.create':
				return accessPolicy.createKey(
					asString(p.name, 'Key name'),
					p.permissions as Permission[],
					p.fields as string[] | undefined,
				);
			case 'access.keys.revoke':
				accessPolicy.revokeKey(asString(p.id, 'Key ID'));
				return { revoked: true };
			case 'recipes.list':
				return recipeManager.listRecipes().map(readonlyRecipe);
			case 'recipes.inspect': {
				return {
					recipe: serializeRecipe(recipeById(id()), remote),
					status: safeStatus(id(), remote),
				};
			}
			case 'recipes.logs':
				return {
					id: id(),
					lines: recipeManager.getStatus(id())?.logTail ?? [],
				};
			case 'recipes.share.show': {
				const recipe = recipeById(id());
				const status = statusForRecipe(recipe);
				const info = pluginTypeRegistry
					.get(recipe.type)
					?.inspectRecipe?.(recipe, status);
				if (!info) throw new Error('This recipe has no inspection capability');
				return {
					id: recipe.id,
					...inspectionSharing.get(recipe.id),
					availableFields: info.fields,
				};
			}
			case 'recipes.share.set': {
				const recipe = recipeById(id());
				const status = statusForRecipe(recipe);
				const info = pluginTypeRegistry
					.get(recipe.type)
					?.inspectRecipe?.(recipe, status);
				if (!info) throw new Error('This recipe has no inspection capability');
				return inspectionSharing.set(
					recipe.id,
					asString(p.mode, 'Sharing mode') as 'disabled' | 'peers' | 'keys',
					p.fields as string[],
					info.fields.map((field) => field.id),
				);
			}
			case 'recipes.metrics': {
				const recipe = recipeById(id());
				const status = statusForRecipe(recipe);
				const info = pluginTypeRegistry
					.get(recipe.type)
					?.inspectRecipe?.(recipe, status);
				if (!info) throw new Error('This recipe has no inspection capability');
				const possible = info.fields.map((field) => field.id);
				const fields =
					p.fields === undefined
						? remote
							? await inspectionSharing.visibleFields(
									recipe.id,
									origin,
									possible,
								)
							: possible
						: p.fields;
				if (
					!Array.isArray(fields) ||
					fields.some(
						(field) => typeof field !== 'string' || !possible.includes(field),
					)
				) {
					throw new Error('Unknown inspection field');
				}
				const selected = [...new Set(fields as string[])];
				if (remote && selected.length === 0)
					throw new Error('No metrics are shared');
				await inspectionSharing.check(recipe.id, origin, selected);
				const snapshot = info.snapshot;
				return {
					id: recipe.id,
					state: status.state,
					fields: info.fields.filter((field) => selected.includes(field.id)),
					sampledAt: snapshot?.sampledAt ?? null,
					scope: snapshot?.scope ?? null,
					metrics: snapshot
						? Object.fromEntries(
								selected.map((field) => [
									field,
									snapshot.metrics[field] ?? null,
								]),
							)
						: null,
				};
			}
			case 'recipes.registry.add':
				return serializeRecipe(await registerRecipe(), remote);
			case 'recipes.import': {
				const recipe = asObject(p.recipe) as unknown as Recipe;
				if (
					typeof recipe.type !== 'string' ||
					!pluginTypeRegistry.get(recipe.type)
				)
					throw new Error('Unsupported recipe type');
				if (!Array.isArray(recipe.modes) || !recipe.env || !recipe.typeConfig)
					throw new Error('Invalid recipe');
				return readonlyRecipe(await recipeManager.save(recipe));
			}
			case 'recipes.remove':
				await recipeManager.remove(id());
				this.notifyRecipe(method, id());
				return { removed: true };
			case 'recipes.install': {
				const recipeId = id();
				if (!['system', 'docker', 'connect'].includes(String(p.mode)))
					throw new Error('Mode must be system, docker or connect');
				if (
					p.source !== undefined &&
					p.source !== 'registry' &&
					p.source !== 'build'
				)
					throw new Error('Source must be registry or build');
				if (
					p.engine !== undefined &&
					(p.mode !== 'docker' ||
						!['docker', 'podman'].includes(String(p.engine)))
				)
					throw new Error(
						'Engine must be docker or podman and requires docker mode',
					);
				if (p.register === true) await registerRecipe();
				const recipe = recipeById(recipeId);
				if (remote && recipe.type === 'infrastructure')
					await accessPolicy.authorize(origin, 'infrastructure.manage');
				if (p.engine)
					recipeManager.setContainerEngineOverride(
						recipeId,
						p.engine as 'docker' | 'podman',
					);
				await recipeManager.install(
					recipeId,
					p.mode as InstallModeKind,
					p.source as DockerInstallSource | undefined,
					{ initializeVolumes: p.initializeVolumes === true },
				);
				success(recipeId);
				return safeStatus(recipeId, remote);
			}
			case 'recipes.uninstall':
				await recipeManager.uninstall(id());
				success(id());
				this.notifyRecipe(method, id());
				return safeStatus(id(), remote);
			case 'recipes.run':
				await recipeManager.run(id());
				success(id());
				this.notifyRecipe(method, id());
				return safeStatus(id(), remote);
			case 'recipes.stop':
				await recipeManager.stop(id());
				this.notifyRecipe(method, id());
				return safeStatus(id(), remote);
			case 'recipes.restart':
				await recipeManager.stop(id());
				await recipeManager.run(id());
				success(id());
				this.notifyRecipe(method, id());
				return safeStatus(id(), remote);
			case 'recipes.set': {
				const recipe = recipeById(id());
				const next = mutateRecipe(
					recipe,
					asString(p.field, 'Field'),
					p.value,
					Boolean(p.delete),
				);
				await recipeManager.save(next);
				return serializeRecipe(next, remote);
			}
			case 'recipes.env.list':
				return Object.keys(recipeById(id()).env);
			case 'recipes.registry.list':
				return recipeRegistry.list(p.refresh !== true);
			case 'recipes.registry.refresh':
				recipeRegistry.clearCache();
				return recipeRegistry.list(false);
			case 'recipes.env.get':
				return recipeById(id()).env[key()] ?? null;
			case 'recipes.env.set': {
				const recipe = recipeById(id());
				const next = mutateRecipe(
					recipe,
					`env.${key()}`,
					asString(p.value, 'Value'),
				);
				await recipeManager.save(next);
				return {
					updated: true,
					restartRequired: recipeManager.getStatus(id())?.state === 'running',
				};
			}
			case 'recipes.env.delete': {
				const recipe = recipeById(id());
				await recipeManager.save(
					mutateRecipe(recipe, `env.${key()}`, null, true),
				);
				return {
					deleted: true,
					restartRequired: recipeManager.getStatus(id())?.state === 'running',
				};
			}
			default:
				throw new Error(`Unknown command: ${method}`);
		}
	}
}
export const chelysControl = new ChelysControl();
