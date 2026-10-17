import { describe, expect, it } from 'vitest';
import type { Recipe } from '@src/plugin-host/types';
import {
	parseStorageImport,
	readStorageTransport,
	recipeToConfigBlock,
} from '@src/plugins/storage/shared';

const recipe: Recipe = {
	id: 'garage',
	type: 'storage',
	name: 'Garage',
	env: {},
	modes: [{ kind: 'connect' }],
	typeConfig: {
		configId: 'garage-local',
		transportType: 'webrtc',
		transportUrl: 'ws://localhost:7060',
		transportRoomId: 'shared-storage-room',
		signalingServers: ['wss://signal.example'],
	},
};

describe('storage plugin configuration', () => {
	it('publishes the same transport through config injection and the recipe bridge', () => {
		expect(recipeToConfigBlock(recipe, true)).toEqual({
			id: 'garage-local',
			name: 'Garage',
			enabled: true,
			transportConfig: {
				type: 'webrtc',
				roomId: 'shared-storage-room',
				signaling: ['wss://signal.example'],
			},
		});
		expect(readStorageTransport(recipe)).toEqual({
			configId: 'garage-local',
			transport: {
				type: 'webrtc',
				url: 'ws://localhost:7060',
				roomId: 'shared-storage-room',
				signaling: ['wss://signal.example'],
			},
		});
	});

	it('imports a generic storage config without provider-specific fields', () => {
		const imported = parseStorageImport(
			JSON.stringify({
				id: 'remote-storage',
				name: 'Remote Storage',
				enabled: true,
				transportConfig: {
					type: 'websocket',
					url: 'wss://storage.example/ws',
				},
			}),
		);

		expect(imported).toMatchObject({
			type: 'storage',
			name: 'Remote Storage',
			selectedMode: 'connect',
			typeConfig: {
				configId: 'remote-storage',
				transportType: 'websocket',
				transportUrl: 'wss://storage.example/ws',
			},
		});
		expect(imported.typeConfig).not.toHaveProperty('bucket');
		expect(imported.typeConfig).not.toHaveProperty('secret');
	});
});
