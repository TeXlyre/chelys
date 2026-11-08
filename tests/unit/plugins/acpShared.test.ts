import { describe, expect, it } from 'vitest';
import {
	ACP_TYPE,
	parseAcpImport,
	readAcpTransport,
	recipeToConfigBlock,
} from '@src/plugins/acp/shared';
import type { Recipe } from '@src/plugin-host/types';

const makeRecipe = (typeConfig: Record<string, unknown>): Recipe => ({
	id: 'claude-agent',
	type: ACP_TYPE,
	name: 'Claude Agent',
	env: {},
	modes: [{ kind: 'connect' }],
	typeConfig,
});

describe('ACP recipe config', () => {
	it('builds a websocket config block without Content-Length framing', () => {
		const block = recipeToConfigBlock(
			makeRecipe({
				configId: 'claude-agent',
				transportUrl: 'ws://localhost:7060',
				cwd: '/home/me/agent',
			}),
			true,
		);

		expect(block).toEqual({
			id: 'claude-agent',
			name: 'Claude Agent',
			enabled: true,
			transportConfig: {
				type: 'websocket',
				url: 'ws://localhost:7060',
				contentLength: false,
			},
			cwd: '/home/me/agent',
		});
	});

	it('omits the url for webrtc transports', () => {
		const block = recipeToConfigBlock(
			makeRecipe({
				configId: 'claude-agent',
				transportType: 'webrtc',
				transportUrl: 'ws://localhost:7060',
				transportRoomId: 'room',
			}),
			true,
		);

		expect(block.transportConfig).toEqual({
			type: 'webrtc',
			roomId: 'room',
			contentLength: false,
		});
	});

	it('forces newline framing on the bridge transport', () => {
		const binding = readAcpTransport(
			makeRecipe({
				configId: 'claude-agent',
				transportUrl: 'ws://localhost:7060',
				contentLength: true,
			}),
		);

		expect(binding?.configId).toBe('claude-agent');
		expect(binding?.transport.contentLength).toBe(false);
	});

	it('round-trips a pasted config block', () => {
		const recipe = parseAcpImport(
			JSON.stringify({
				id: 'gemini',
				name: 'Gemini',
				enabled: true,
				transportConfig: { type: 'websocket', url: 'ws://localhost:7061' },
				mcpServers: '[]',
				sessionMeta: '{"claudeCode":{}}',
			}),
		);

		expect(recipe.type).toBe(ACP_TYPE);
		expect(recipe.selectedMode).toBe('connect');
		expect(recipeToConfigBlock(recipe, true)).toMatchObject({
			id: 'gemini',
			name: 'Gemini',
			transportConfig: { url: 'ws://localhost:7061', contentLength: false },
			mcpServers: '[]',
			sessionMeta: '{"claudeCode":{}}',
		});
	});
});
