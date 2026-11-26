// tests/unit/control/policy.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveAccountId } from '@src/plugin-host/activeAccount';
import { accessPolicy } from '@src/control/policy';

beforeEach(() => {
	const items = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => items.set(key, value),
		removeItem: (key: string) => items.delete(key),
	});
	setActiveAccountId('test-account');
});

describe('control access policies', () => {
	it('defaults to denying every remote request', async () => {
		expect(accessPolicy.mode()).toBe('disabled');
		await expect(accessPolicy.authorize({ transport: 'webrtc', peerKind: 'chelys' }, 'recipes.read')).rejects.toThrow('disabled');
		await expect(accessPolicy.authorize({ transport: 'local' }, 'recipes.remove')).resolves.toBeUndefined();
	});
	it('allows verified account peers, and rejects anonymous WebSocket clients', async () => {
		accessPolicy.setMode('peers');
		await expect(accessPolicy.authorize({ transport: 'webrtc', peerKind: 'texlyre' }, 'recipes.run')).resolves.toBeUndefined();
		await expect(accessPolicy.authorize({ transport: 'websocket' }, 'recipes.run')).rejects.toThrow('authenticated WebRTC');
		await expect(accessPolicy.authorize({ transport: 'webrtc', peerKind: 'chelys' }, 'texlyre.secrets.read')).rejects.toThrow('API-key mode');
		await expect(accessPolicy.authorize({ transport: 'webrtc', peerKind: 'texlyre' }, 'chelys.settings.write')).rejects.toThrow('API-key mode');
		await expect(accessPolicy.authorize({ transport: 'webrtc', peerKind: 'texlyre' }, 'infrastructure.manage')).rejects.toThrow('Elevated infrastructure');
		await expect(accessPolicy.authorize({ transport: 'webrtc', peerKind: 'texlyre' }, 'infrastructure.logs')).rejects.toThrow('Elevated infrastructure');
	});
	it('generates one-time keys, restricts permissions and revokes immediately', async () => {
		accessPolicy.setMode('keys');
		const created = await accessPolicy.createKey('read-only', ['inventory.read', 'recipes.read']);
		expect(created.key).toMatch(/^chlys_[a-f0-9]{64}$/);
		const listed = accessPolicy.listKeys();
		expect(listed).toHaveLength(1);
		expect(JSON.stringify(listed)).not.toContain(created.key);
		const caller = { transport: 'websocket' as const, apiKey: created.key };
		await expect(accessPolicy.authorize(caller, 'recipes.read')).resolves.toBeUndefined();
		await expect(accessPolicy.authorize(caller, 'recipes.install')).rejects.toThrow('does not grant');
		accessPolicy.revokeKey(created.id);
		await expect(accessPolicy.authorize(caller, 'recipes.read')).rejects.toThrow('does not grant');
	});
	it('separates Chelys and TeXlyre data permissions including secret read and write', async () => {
		accessPolicy.setMode('keys');
		const token = await accessPolicy.createKey('configuration-editor', ['chelys.settings.write', 'texlyre.properties.read', 'texlyre.secrets.write']);
		const caller = { transport: 'webrtc' as const, peerKind: 'chelys' as const, apiKey: token.key };
		await expect(accessPolicy.authorize(caller, 'chelys.settings.write')).resolves.toBeUndefined();
		await expect(accessPolicy.authorize(caller, 'texlyre.properties.read')).resolves.toBeUndefined();
		await expect(accessPolicy.authorize(caller, 'texlyre.secrets.write')).resolves.toBeUndefined();
		await expect(accessPolicy.authorize(caller, 'texlyre.secrets.read')).rejects.toThrow('does not grant');
		await expect(accessPolicy.authorize(caller, 'texlyre.properties.write')).rejects.toThrow('does not grant');
	});
	it('does not share permissions between different accounts on one machine', async () => {
		accessPolicy.setMode('peers');
		setActiveAccountId('different-account');
		expect(accessPolicy.mode()).toBe('disabled');
	});
});
