// src/runtime/storageMirror.ts
import { localCommand } from '../control/localClient';

let pending: Promise<unknown> = Promise.resolve();
let initialized: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Keep browser-only views (theme, settings editor, JSON tools) in sync with the authoritative daemon store. */
export function initializeSharedStorage(): Promise<void> {
	if (initialized) return initialized;
	initialized = (async () => {
		const browser: Record<string, string> = {};
		for (let index = 0; index < localStorage.length; index++) {
			const key = localStorage.key(index);
			if (key !== null) {
				const value = localStorage.getItem(key);
				if (value !== null) browser[key] = value;
			}
		}
		const shared = await localCommand<Record<string, string>>('storage.sync', {
			browser,
			seed: true,
		});
		for (const key of Object.keys(browser)) {
			if (!Object.hasOwn(shared, key)) localStorage.removeItem(key);
		}
		for (const [key, value] of Object.entries(shared)) {
			if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
		}
		const set = Storage.prototype.setItem;
		const remove = Storage.prototype.removeItem;
		const clear = Storage.prototype.clear;
		const queue = (operation: string, key?: string, value?: string) => {
			pending = pending
				.then(() =>
					localCommand('storage.mutate', {
						operation,
						...(key !== undefined ? { key } : {}),
						...(value !== undefined ? { value } : {}),
					}),
				)
				.catch((error) =>
					console.error('[Chelys] Shared storage write failed', error),
				);
		};
		Storage.prototype.setItem = function (key: string, value: string) {
			set.call(this, key, value);
			if (this === localStorage) queue('set', String(key), String(value));
		};
		Storage.prototype.removeItem = function (key: string) {
			remove.call(this, key);
			if (this === localStorage) queue('delete', String(key));
		};
		Storage.prototype.clear = function () {
			clear.call(this);
			if (this === localStorage) queue('clear');
		};
		// Commands issued by the CLI (or remote peers) may change settings while
		// the desktop is open. Reconcile read-only snapshots without sending echoes.
		const refreshFromBackend = async () => {
			await pending;
			const external = await localCommand<Record<string, string>>(
				'storage.sync',
				{ seed: false },
			);
			const keys = new Set([
				...Object.keys(external),
				...Array.from({ length: localStorage.length }, (_, i) =>
					localStorage.key(i),
				).filter((key): key is string => key !== null),
			]);
			for (const key of keys) {
				const current = localStorage.getItem(key);
				const next = Object.hasOwn(external, key) ? external[key] : null;
				if (next === current) continue;
				if (next === null) remove.call(localStorage, key);
				else set.call(localStorage, key, next);
				window.dispatchEvent(
					new CustomEvent('chelys-storage-updated', {
						detail: { key, value: next },
					}),
				);
			}
		};
		if (!refreshTimer)
			refreshTimer = setInterval(() => {
				void refreshFromBackend().catch((error) =>
					console.warn('[Chelys] Shared storage refresh failed', error),
				);
			}, 3000);
	})();
	return initialized;
}

export async function flushSharedStorage(): Promise<void> {
	await initialized;
	await pending;
}
