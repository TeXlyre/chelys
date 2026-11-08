// src/plugins/acp/shared.ts
import { nanoid } from 'nanoid';

import type { TransportBinding } from '../../plugin-host/bridgeHooks';
import type { Recipe } from '../../plugin-host/types';
import type { AcpConfigBlock, AcpTypeConfig } from './types';

export const ACP_TYPE = 'acp';

// ACP is newline-delimited JSON-RPC, never LSP-style Content-Length framing.
const CONTENT_LENGTH = false;

function toBlockTransport(
	config: AcpTypeConfig,
): AcpConfigBlock['transportConfig'] {
	const type = config.transportType ?? 'websocket';

	if (type === 'webrtc') {
		return {
			type,
			...(config.transportRoomId ? { roomId: config.transportRoomId } : {}),
			...(config.signalingServers?.length
				? { signaling: config.signalingServers }
				: {}),
			contentLength: CONTENT_LENGTH,
		};
	}

	return {
		type,
		url: config.transportUrl,
		contentLength: CONTENT_LENGTH,
	};
}

export function recipeToConfigBlock(
	recipe: Recipe,
	enabled: boolean,
): AcpConfigBlock {
	const config = recipe.typeConfig as unknown as AcpTypeConfig;
	return {
		id: config.configId,
		name: recipe.name,
		enabled,
		...(recipe.icon ? { icon: recipe.icon } : {}),
		transportConfig: toBlockTransport(config),
		...(config.cwd ? { cwd: config.cwd } : {}),
		...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
		...(config.sessionMeta ? { sessionMeta: config.sessionMeta } : {}),
	};
}

export function readAcpTransport(recipe: Recipe): TransportBinding | null {
	const config = recipe.typeConfig as unknown as AcpTypeConfig;
	if (!config) return null;

	return {
		configId: config.configId,
		transport: {
			type: config.transportType ?? 'websocket',
			url: config.transportUrl,
			roomId: config.transportRoomId,
			signaling: config.signalingServers,
			contentLength: CONTENT_LENGTH,
		},
	};
}

export function parseAcpImport(raw: string): Recipe {
	const parsed = JSON.parse(raw);
	const block: AcpConfigBlock = Array.isArray(parsed) ? parsed[0] : parsed;
	if (!block || typeof block !== 'object') {
		throw new Error('Paste a TeXlyre ACP config block or recipe JSON');
	}

	const transport = block.transportConfig ?? {
		type: 'websocket' as const,
		url: 'ws://localhost:7060',
	};

	const typeConfig: AcpTypeConfig = {
		configId: block.id || nanoid(),
		transportType: transport.type ?? 'websocket',
		transportUrl: transport.url ?? 'ws://localhost:7060',
		transportRoomId: transport.roomId,
		signalingServers: transport.signaling,
		cwd: block.cwd,
		mcpServers: block.mcpServers,
		sessionMeta: block.sessionMeta,
	};

	return {
		id: nanoid(),
		type: ACP_TYPE,
		name: block.name || block.id || 'Imported agent',
		env: {},
		modes: [{ kind: 'connect' }],
		selectedMode: 'connect',
		typeConfig: typeConfig as unknown as Record<string, unknown>,
	};
}
