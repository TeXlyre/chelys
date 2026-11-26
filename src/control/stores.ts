// src/control/stores.ts
import { getActiveAccountId } from '../plugin-host/activeAccount';
import { chelysAccountSyncService } from '@texlyre/services/ChelysAccountSyncService';

export const STORE_NAMES = [
	'settings',
	'properties',
	'records',
	'secrets',
] as const;
export type StoreName = (typeof STORE_NAMES)[number];

function storageKey(store: StoreName): string {
	const account = getActiveAccountId();
	if (!account) throw new Error('Login required');
	if (!STORE_NAMES.includes(store)) throw new Error('Unknown account store');
	return `texlyre-user-${account}-${store}`;
}
function read(store: StoreName): Record<string, unknown> {
	const raw = localStorage.getItem(storageKey(store));
	if (!raw) return {};
	const value: unknown = JSON.parse(raw);
	if (store === 'secrets') {
		if (!Array.isArray(value)) throw new Error('Secrets data must be an array');
		return Object.fromEntries(
			value.map((secret: any) => [secretId(secret), secret]),
		);
	}
	if (!value || Array.isArray(value) || typeof value !== 'object')
		throw new Error('Store is not a JSON object');
	return value as Record<string, unknown>;
}
function secretId(secret: any): string {
	if (
		!secret ||
		typeof secret !== 'object' ||
		!secret.pluginId ||
		!secret.secretKey ||
		!secret.scope
	)
		throw new Error('Invalid secret object');
	return [
		secret.pluginId,
		secret.scope,
		...(secret.scope === 'project' && secret.projectId
			? [secret.projectId]
			: []),
		secret.secretKey,
	].join(':');
}
function write(store: StoreName, data: Record<string, unknown>): void {
	localStorage.setItem(
		storageKey(store),
		JSON.stringify(store === 'secrets' ? Object.values(data) : data),
	);
	chelysAccountSyncService.publishStore(store);
	window.dispatchEvent(
		new CustomEvent('chelys-account-store-changed', { detail: { store } }),
	);
}

export const accountStores = {
	publish(store: StoreName): void {
		chelysAccountSyncService.publishStore(store);
	},
	list(store: StoreName): string[] {
		return Object.keys(read(store)).filter((key) => key !== '_version');
	},
	get(store: StoreName, key: string): unknown {
		const value = read(store);
		if (!Object.hasOwn(value, key)) throw new Error(`Key not found: ${key}`);
		return value[key];
	},
	set(store: StoreName, key: string, value: unknown): void {
		if (
			!key ||
			key === '_version' ||
			['__proto__', 'prototype', 'constructor'].includes(key)
		)
			throw new Error('Invalid key');
		const content = read(store);
		if (store === 'secrets') {
			if (secretId(value) !== key)
				throw new Error(
					'Secret key must equal pluginId:scope[:projectId]:secretKey',
				);
		}
		if (
			store === 'records' &&
			(!Array.isArray(value) ||
				value.some(
					(entry) =>
						!entry ||
						typeof entry !== 'object' ||
						typeof entry.id !== 'string' ||
						typeof entry.timestamp !== 'number' ||
						!Object.hasOwn(entry, 'data'),
				))
		) {
			throw new Error(
				'Records require an array of { id, timestamp, data } entries',
			);
		}
		content[key] = value;
		write(store, content);
	},
	appendRecord(
		key: string,
		data: unknown,
	): { id: string; timestamp: number; data: unknown } {
		const current = read('records')[key] ?? [];
		if (!Array.isArray(current)) throw new Error(`Invalid record list: ${key}`);
		const entry = { id: crypto.randomUUID(), timestamp: Date.now(), data };
		this.set('records', key, [...current, entry]);
		return entry;
	},
	removeRecord(key: string, recordId: string): void {
		const entries = this.get('records', key);
		if (!Array.isArray(entries)) throw new Error(`Invalid record list: ${key}`);
		if (!entries.some((entry) => entry.id === recordId))
			throw new Error(`Unknown record: ${recordId}`);
		this.set(
			'records',
			key,
			entries.filter((entry) => entry.id !== recordId),
		);
	},
	delete(store: StoreName, key: string): void {
		const content = read(store);
		if (key === '_version' || !Object.hasOwn(content, key))
			throw new Error(`Key not found: ${key}`);
		delete content[key];
		write(store, content);
	},
};
