import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveAccountId } from '@src/plugin-host/activeAccount';
import { accessPolicy, keyHash } from '@src/control/policy';
import { controlKey, dedicatedRoom, makeInvitation, newChallenge, parseInvitation, seal, unseal } from '@src/control/dedicated';

beforeEach(() => {
	const items = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => items.set(key, value),
	});
	setActiveAccountId('target-account');
	accessPolicy.setMode('keys');
});

describe('dedicated control authentication', () => {
	it('makes a stable key-specific invitation without exposing key material', async () => {
		const { key } = await accessPolicy.createKey('reader', ['recipes.read']);
		const hash = await keyHash(key);
		const invitation = await makeInvitation(hash, ['wss://signal.example']);
		const data = parseInvitation(invitation);
		expect(data.room).toBe(await dedicatedRoom(await keyHash(key)));
		expect(data.signaling).toEqual(['wss://signal.example']);
		expect(JSON.stringify(data)).not.toContain(key);
		expect(JSON.stringify(data)).not.toContain(hash);
		expect(await makeInvitation(hash, data.signaling)).toBe(invitation);
		const other = await accessPolicy.createKey('other', ['recipes.read']);
		expect(await dedicatedRoom(await keyHash(other.key))).not.toBe(data.room);
	});
	it('rejects malformed invitations and unsafe signaling URLs', async () => {
		expect(() => parseInvitation('chelys-webrtc:invalid')).toThrow();
		await expect(makeInvitation('a'.repeat(64), ['https://signal.example'])).rejects.toThrow();
		await expect(makeInvitation('a'.repeat(64), ['wss://user:secret@signal.example'])).rejects.toThrow();
		await expect(makeInvitation('a'.repeat(64), ['ws://signal.example'])).rejects.toThrow();
	});
	it('encrypts request and response and rejects wrong keys, replays and reflection', async () => {
		const { key } = await accessPolicy.createKey('reader', ['recipes.read']);
		const client = await controlKey(await keyHash(key));
		const host = await controlKey(accessPolicy.dedicatedKeys()[0].hash);
		const challenge = newChallenge();
		const request = JSON.stringify({ method: 'recipes.list', apiKey: key });
		const envelope = await seal(client, challenge, 'request', request);
		expect(envelope).not.toContain(key);
		expect(await unseal(host, challenge, 'request', envelope)).toBe(request);
		await expect(unseal(host, newChallenge(), 'request', envelope)).rejects.toThrow();
		await expect(unseal(host, challenge, 'response', envelope)).rejects.toThrow();
		const wrong = await controlKey('b'.repeat(64));
		await expect(unseal(wrong, challenge, 'request', envelope)).rejects.toThrow();
		const corrupted = JSON.parse(envelope);
		corrupted.data = (corrupted.data[0] === 'A' ? 'B' : 'A') + corrupted.data.slice(1);
		await expect(unseal(host, challenge, 'request', JSON.stringify(corrupted))).rejects.toThrow();
		const response = await seal(host, challenge, 'response', '["recipe"]');
		expect(await unseal(client, challenge, 'response', response)).toBe('["recipe"]');
	});
	it('uses existing permissions, rejects revoked keys and never trusts dedicated account-peer claims', async () => {
		const { key, id } = await accessPolicy.createKey('reader', ['recipes.read']);
		const caller = { transport: 'webrtc' as const, dedicated: true, peerKind: 'chelys' as const, apiKey: key };
		await expect(accessPolicy.authorize(caller, 'recipes.read')).resolves.toBeUndefined();
		await expect(accessPolicy.authorize(caller, 'recipes.run')).rejects.toThrow();
		accessPolicy.setMode('peers');
		expect(accessPolicy.dedicatedKeys()).toEqual([]);
		await expect(accessPolicy.authorize(caller, 'recipes.read')).rejects.toThrow();
		accessPolicy.setMode('keys');
		accessPolicy.revokeKey(id);
		expect(accessPolicy.dedicatedKeys()).toEqual([]);
		await expect(accessPolicy.authorize(caller, 'recipes.read')).rejects.toThrow();
	});
});
