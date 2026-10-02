import { beforeAll, describe, expect, it } from 'vitest';
import { pluginTypeRegistry } from '@src/plugin-host/PluginTypeRegistry';
import {
	applyShareMode,
	describeRecipeShare,
	readShareMode,
} from '@src/plugin-host/recipeSharing';
import type { Recipe } from '@src/plugin-host/types';

const TYPE = 'share-test';

beforeAll(() => {
	pluginTypeRegistry.register({
		type: TYPE,
		label: 'Share test',
		seeds: [],
		formSchema: [],
		toConfigBlock: (recipe) => ({ ...recipe.typeConfig }),
	});
});

const makeRecipe = (typeConfig: Record<string, unknown>): Recipe => ({
	id: 'compiler',
	type: TYPE,
	name: 'Compiler',
	env: {},
	modes: [{ kind: 'connect' }],
	typeConfig,
});

describe('recipe sharing', () => {
	it('blocks account-derived WebRTC rooms because they resolve differently for recipients', () => {
		const info = describeRecipeShare(
			makeRecipe({
				configId: 'compiler',
				transportType: 'webrtc',
			}),
		);

		expect(info.state).toBe('blocked');
		expect(info.transportType).toBe('webrtc');
		expect(info.json).not.toBeNull();
	});

	it('allows WebRTC recipes with an explicit shared room', () => {
		const info = describeRecipeShare(
			makeRecipe({
				configId: 'compiler',
				transportType: 'webrtc',
				transportRoomId: 'shared-typesetters',
			}),
		);

		expect(info.state).toBe('ready');
	});

	it.each([
		'ws://localhost:7000',
		'ws://127.0.0.1:7000',
		'http://0.0.0.0:7000/path',
		'ws://[::1]:7000',
	])('warns when a websocket share points only at loopback: %s', (transportUrl) => {
		const info = describeRecipeShare(
			makeRecipe({
				configId: 'compiler',
				transportType: 'websocket',
				transportUrl,
			}),
		);

		expect(info.state).toBe('warning');
	});

	it('switches share modes without leaving a stale room override', () => {
		const roomRecipe = applyShareMode(
			makeRecipe({ configId: 'compiler', transportType: 'websocket' }),
			'webrtc-room',
		);

		expect(readShareMode(roomRecipe)).toBe('webrtc-room');
		expect(roomRecipe.typeConfig.transportRoomId).toMatch(/^compiler-/);

		const accountRecipe = applyShareMode(roomRecipe, 'webrtc-account');
		expect(readShareMode(accountRecipe)).toBe('webrtc-account');
		expect(accountRecipe.typeConfig).not.toHaveProperty('transportRoomId');

		const websocketRecipe = applyShareMode(roomRecipe, 'websocket');
		expect(readShareMode(websocketRecipe)).toBe('websocket');
		expect(websocketRecipe.typeConfig).not.toHaveProperty('transportRoomId');
	});
});
