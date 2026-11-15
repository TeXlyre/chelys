// tests/unit/control/settings.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveAccountId } from '@src/plugin-host/activeAccount';
import { chelysSettings } from '@src/control/settings';
import { accountStores } from '@src/control/stores';

vi.mock('@texlyre/services/ChelysAccountSyncService', () => ({
	chelysAccountSyncService: { publishStore: vi.fn() },
}));

beforeEach(() => {
	const values = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
	});
	vi.stubGlobal('window', { dispatchEvent: vi.fn() });
	setActiveAccountId('account-1');
});

describe('separate Chelys and TeXlyre account stores', () => {
	it('writes Chelys settings independently with validated keys and types', () => {
		expect(chelysSettings.get('collabAutoReconnect')).toBe(true);
		chelysSettings.set('collabAutoReconnect', false);
		expect(chelysSettings.get('collabAutoReconnect')).toBe(false);
		expect(localStorage.getItem('chelys-user-account-1-settings')).toContain('collabAutoReconnect');
		expect(localStorage.getItem('texlyre-user-account-1-settings')).toBeNull();
		expect(() => chelysSettings.set('collabAutoReconnect', 'false')).toThrow('requires a boolean');
		expect(() => chelysSettings.set('defaultContainerEngine', 'unknown')).toThrow('must be one of');
		expect(() => chelysSettings.set('unknown', 1)).toThrow('Unknown Chelys setting');
		chelysSettings.delete('collabAutoReconnect');
		expect(chelysSettings.get('collabAutoReconnect')).toBe(true);
	});

	it('preserves TeXlyre record-entry arrays for append, retrieve and removal', () => {
		const entry = accountStores.appendRecord('build-metadata:global', { status: 'done' });
		expect(entry.data).toEqual({ status: 'done' });
		expect(accountStores.get('records', 'build-metadata:global')).toEqual([entry]);
		expect(() => accountStores.set('records', 'build-metadata:global', { status: 'invalid' })).toThrow('require an array');
		accountStores.removeRecord('build-metadata:global', entry.id);
		expect(accountStores.get('records', 'build-metadata:global')).toEqual([]);
	});
});
