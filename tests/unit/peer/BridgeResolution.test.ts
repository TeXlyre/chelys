import { afterEach, describe, expect, it } from 'vitest';
import {
	resolveSignalingServers,
	resolveTransportRoomId,
} from '@src/peer/BridgeResolution';
import { setActiveAccountId } from '@src/plugin-host/activeAccount';

afterEach(() => {
	setActiveAccountId(null);
});

describe('bridge resolution', () => {
	it('uses an explicit transport room without coupling it to the account', () => {
		setActiveAccountId('account-a');

		expect(resolveTransportRoomId('ltex', 'shared-room')).toBe('shared-room');
	});

	it('derives a stable per-service room from the active account when no override exists', () => {
		setActiveAccountId('account-a');

		expect(resolveTransportRoomId('ltex')).toBe('account-a:ltex');
		expect(resolveTransportRoomId('typst')).toBe('account-a:typst');
	});

	it('does not invent a room when there is no active account', () => {
		expect(resolveTransportRoomId('ltex')).toBeNull();
	});

	it('prefers explicit signaling servers and otherwise uses configured defaults', () => {
		expect(resolveSignalingServers(['wss://one', 'wss://two'])).toEqual([
			'wss://one',
			'wss://two',
		]);
		expect(resolveSignalingServers()).toEqual(['wss://ywebrtc.texlyre.org']);
	});
});
