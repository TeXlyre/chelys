// src/control/policy.ts
import { getActiveAccountId } from '../plugin-host/activeAccount';

export type AccessMode = 'disabled' | 'peers' | 'keys';
export const PERMISSIONS = [
	'inventory.read',
	'machine.read',
	'recipes.telemetry.read',
	'infrastructure.logs',
	'infrastructure.manage',
	'recipes.read',
	'recipes.logs',
	'recipes.edit',
	'recipes.install',
	'recipes.run',
	'recipes.remove',
	'instance.profile.read',
	'instance.profile.edit',
	'chelys.settings.read',
	'chelys.settings.write',
	'texlyre.settings.read',
	'texlyre.settings.write',
	'texlyre.properties.read',
	'texlyre.properties.write',
	'texlyre.records.read',
	'texlyre.records.write',
	'texlyre.secrets.read',
	'texlyre.secrets.write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

interface KeyRecord {
	id: string;
	name: string;
	hash: string;
	permissions: Permission[];
	fields?: string[];
	createdAt: string;
}
interface AccessConfig {
	mode: AccessMode;
	keys: KeyRecord[];
}
export interface RequestOrigin {
	transport: 'local' | 'webrtc' | 'websocket';
	peerKind?: 'chelys' | 'texlyre';
	apiKey?: string;
	/** Dedicated sessions never inherit account-peer trust. */
	dedicated?: boolean;
}
const STORAGE_PREFIX = 'chelys-control-access:';
const listeners = new Set<() => void>();
const encodeHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const keyHash = async (key: string): Promise<string> =>
	encodeHex(
		new Uint8Array(
			await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)),
		),
	);

function read(): AccessConfig {
	const account = getActiveAccountId();
	if (!account) return { mode: 'disabled', keys: [] };
	try {
		const parsed = JSON.parse(
			localStorage.getItem(STORAGE_PREFIX + account) || 'null',
		);
		return {
			mode:
				parsed?.mode === 'peers' || parsed?.mode === 'keys'
					? parsed.mode
					: 'disabled',
			keys: Array.isArray(parsed?.keys) ? parsed.keys : [],
		};
	} catch {
		return { mode: 'disabled', keys: [] };
	}
}
function write(value: AccessConfig): void {
	const account = getActiveAccountId();
	if (!account) throw new Error('Login required');
	localStorage.setItem(STORAGE_PREFIX + account, JSON.stringify(value));
	for (const listener of listeners) listener();
}

export const accessPolicy = {
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	mode: (): AccessMode => read().mode,
	setMode(mode: AccessMode): void {
		if (!['disabled', 'peers', 'keys'].includes(mode))
			throw new Error('Invalid access mode');
		write({ ...read(), mode });
	},
	/** Backend-only key material; never returned by an RPC. */
	dedicatedKeys(): Array<{ id: string; hash: string }> {
		const config = read();
		return config.mode === 'keys' ? config.keys.map(({ id, hash }) => ({ id, hash })) : [];
	},
	listKeys(): Array<Omit<KeyRecord, 'hash'>> {
		return read().keys.map(({ hash: _hash, ...value }) => value);
	},
	async createKey(
		name: string,
		permissions: Permission[],
		fields?: string[],
	): Promise<{ id: string; key: string }> {
		if (!name.trim()) throw new Error('Key name required');
		if (
			!Array.isArray(permissions) ||
			!permissions.length ||
			permissions.some((item) => !PERMISSIONS.includes(item))
		) {
			throw new Error('Specify one or more valid permissions');
		}
		if (
			fields !== undefined &&
			(!Array.isArray(fields) ||
				fields.some(
					(item) =>
						typeof item !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(item),
				))
		) {
			throw new Error('Invalid API key inspection fields');
		}
		const random = crypto.getRandomValues(new Uint8Array(32));
		const key = `chlys_${encodeHex(random)}`;
		const id = crypto.randomUUID();
		const config = read();
		config.keys.push({
			id,
			name: name.trim(),
			hash: await keyHash(key),
			permissions: [...new Set(permissions)],
			...(fields ? { fields: [...new Set(fields)] } : {}),
			createdAt: new Date().toISOString(),
		});
		write(config);
		return { id, key };
	},
	revokeKey(id: string): void {
		const config = read();
		if (!config.keys.some((key) => key.id === id))
			throw new Error('Unknown key');
		write({ ...config, keys: config.keys.filter((key) => key.id !== id) });
	},
	async authorize(
		origin: RequestOrigin,
		permission: Permission,
		fields: string[] = [],
	): Promise<void> {
		if (origin.transport === 'local') return;
		const config = read();
		if (config.mode === 'disabled')
			throw new Error('Remote control is disabled');
		if (origin.dedicated && config.mode !== 'keys')
			throw new Error('Dedicated remote control requires API-key mode');
		if (config.mode === 'peers') {
			if (
				permission === 'infrastructure.manage' ||
				permission === 'infrastructure.logs'
			) {
				throw new Error(
					'Elevated infrastructure operations require an explicit API key',
				);
			}
			if (
				permission.startsWith('texlyre.') ||
				permission.startsWith('chelys.settings.') ||
				permission.startsWith('instance.profile.')
			) {
				throw new Error(
					'Account data and profiles require API-key mode with explicit permissions',
				);
			}
			if (
				origin.transport === 'webrtc' &&
				(origin.peerKind === 'chelys' || origin.peerKind === 'texlyre')
			)
				return;
			throw new Error(
				'This policy requires an authenticated WebRTC account peer',
			);
		}
		if (
			typeof origin.apiKey !== 'string' ||
			!/^chlys_[a-f0-9]{64}$/.test(origin.apiKey)
		) {
			throw new Error('A Chelys API key is required');
		}
		const hash = await keyHash(origin.apiKey);
		// The account or access policy may have changed while hashing.
		const current = read();
		if (current.mode !== 'keys') throw new Error('API-key mode is no longer active');

		let allowed = false;
		for (const record of current.keys) {
			const allowedFields = record.fields;
			let difference = 0;
			for (let i = 0; i < 64; i++)
				difference |= hash.charCodeAt(i) ^ record.hash.charCodeAt(i);
			if (
				difference === 0 &&
				record.permissions.includes(permission) &&
				(!fields.length ||
					!allowedFields ||
					fields.every((field) => allowedFields.includes(field)))
			)
				allowed = true;
		}
		if (!allowed) throw new Error(`API key does not grant ${permission}`);
	},
};
