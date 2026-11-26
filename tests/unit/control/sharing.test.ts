// tests/unit/control/sharing.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveAccountId } from '@src/plugin-host/activeAccount';
import { accessPolicy } from '@src/control/policy';
import { inspectionSharing } from '@src/control/sharing';

beforeEach(() => {
	const data = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (name: string) => data.get(name) ?? null,
		setItem: (name: string, value: string) => data.set(name, value),
		removeItem: (name: string) => data.delete(name),
	});
	setActiveAccountId('sharing-test');
});

const webrtc = { transport: 'webrtc' as const, peerKind: 'chelys' as const };
const websocket = { transport: 'websocket' as const };

const fields = ['cpu', 'memory', 'gpu', 'temperatures', 'energy'];

describe('recipe inspection sharing is deny-by-default', () => {
	it('denies all remote telemetry until both remote policy and recipe sharing opt in', async () => {
		await expect(inspectionSharing.check('system-monitor', webrtc, ['cpu'])).rejects.toThrow('not shared');
		accessPolicy.setMode('peers');
		await expect(inspectionSharing.check('system-monitor', webrtc, ['cpu'])).rejects.toThrow('not shared');
		inspectionSharing.set('system-monitor', 'peers', ['cpu', 'memory'], fields);
		await expect(inspectionSharing.check('system-monitor', webrtc, ['cpu'])).resolves.toBeUndefined();
		await expect(inspectionSharing.check('system-monitor', webrtc, ['energy'])).rejects.toThrow('not shared');
		await expect(inspectionSharing.check('system-monitor', websocket, ['cpu'])).rejects.toThrow('verified account peers');
	});

	it('requires explicit telemetry permission, field scope, and active key mode', async () => {
		accessPolicy.setMode('keys');
		inspectionSharing.set('system-monitor', 'keys', ['cpu', 'memory', 'gpu'], fields);
		const { id, key } = await accessPolicy.createKey('observer', ['recipes.telemetry.read'], ['cpu', 'memory']);
		const remote = { ...websocket, apiKey: key };
		await expect(inspectionSharing.check('system-monitor', remote, ['cpu', 'memory'])).resolves.toBeUndefined();
		await expect(inspectionSharing.check('system-monitor', remote, ['gpu'])).rejects.toThrow('does not grant');
		expect(await inspectionSharing.visibleFields('system-monitor', remote, ['cpu', 'memory', 'gpu', 'energy'])).toEqual(['cpu', 'memory']);
		await expect(inspectionSharing.check('system-monitor', remote, ['energy'])).rejects.toThrow('not shared');
		accessPolicy.revokeKey(id);
		await expect(inspectionSharing.check('system-monitor', remote, ['cpu'])).rejects.toThrow('does not grant');
		accessPolicy.setMode('peers');
		await expect(inspectionSharing.check('system-monitor', remote, ['cpu'])).rejects.toThrow('API-key policy');
	});

	it('rejects invalid categories and does not share policies across accounts', () => {
		expect(() => inspectionSharing.set('system-monitor', 'peers', ['secrets'], fields)).toThrow('Unknown inspection');
		inspectionSharing.set('system-monitor', 'peers', ['cpu'], fields);
		setActiveAccountId('other-account');
		expect(inspectionSharing.get('system-monitor')).toEqual({ mode: 'disabled', fields: [] });
	});
});
