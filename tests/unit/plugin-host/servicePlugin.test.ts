import { describe, expect, it } from 'vitest';
import type { Recipe } from '@src/plugin-host/types';
import {
	readServiceTransport,
	recipeToConfigBlock,
	serviceConfigKey,
} from '@src/plugins/service/shared';

const recipe: Recipe = {
	id: 'example',
	type: 'service',
	name: 'Example',
	env: { SECRET: 'not-public' },
	modes: [{ kind: 'connect' }],
	typeConfig: {
		configId: 'example-gpu-01',
		protocol: 'example/1',
		transportUrl: 'ws://localhost:9070/socket',
	},
};

describe('generic service configuration', () => {
	it('exports a direct WebSocket descriptor', () => {
		expect(readServiceTransport(recipe)).toMatchObject({
			configId: 'example-gpu-01',
			transport: { type: 'websocket', url: 'ws://localhost:9070/socket' },
		});
		expect(recipeToConfigBlock(recipe, true)).toEqual({
			id: 'example-gpu-01',
			name: 'Example',
			protocol: 'example/1',
			enabled: true,
			transportConfig: {
				type: 'websocket',
				url: 'ws://localhost:9070/socket',
			},
		});
	});

	it('keeps the backend URL private for WebRTC and retains account room defaults', () => {
		const service: Recipe = {
			...recipe,
			typeConfig: { ...recipe.typeConfig, transportType: 'webrtc' },
		};
		expect(readServiceTransport(service)?.transport.url).toBe(
			'ws://localhost:9070/socket',
		);
		expect(recipeToConfigBlock(service, true).transportConfig).toEqual({
			type: 'webrtc',
		});
	});

	it('preserves explicit rooms and signaling servers', () => {
		const service: Recipe = {
			...recipe,
			typeConfig: {
				...recipe.typeConfig,
				transportType: 'webrtc',
				transportRoomId: 'example-room',
				signalingServers: ['wss://signal.example'],
			},
		};
		expect(recipeToConfigBlock(service, true).transportConfig).toEqual({
			type: 'webrtc',
			roomId: 'example-room',
			signaling: ['wss://signal.example'],
		});
	});

	it.each([
		{ configId: '' },
		{ configId: 'bad id' },
		{ protocol: '' },
		{ transportType: 'worker' },
		{ transportUrl: 'http://localhost:9070' },
		{ transportUrl: 'ws://user:password@localhost:9070' },
	])('does not advertise invalid transport configuration: %j', (override) => {
		const service = {
			...recipe,
			typeConfig: { ...recipe.typeConfig, ...override },
		};
		expect(readServiceTransport(service)).toBeNull();
		expect(recipeToConfigBlock(service, true).enabled).toBe(false);
	});

	it('uses one account setting per service instance', () => {
		expect(serviceConfigKey('example-gpu-01')).toBe(
			'generic-service-config:example-gpu-01',
		);
		expect(serviceConfigKey('example-gpu-01')).not.toBe(
			serviceConfigKey('example-gpu-02'),
		);
		expect(recipeToConfigBlock(recipe, false).enabled).toBe(false);
	});
});
