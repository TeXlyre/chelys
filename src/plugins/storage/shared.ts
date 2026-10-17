// src/plugins/storage/shared.ts
import { nanoid } from 'nanoid';

import type { TransportBinding } from '../../plugin-host/bridgeHooks';
import type { Recipe } from '../../plugin-host/types';
import type { StorageConfigBlock, StorageTypeConfig } from './types';

export const STORAGE_TYPE = 'storage';

function toBlockTransport(
	config: StorageTypeConfig,
): StorageConfigBlock['transportConfig'] {
	const type = config.transportType ?? 'websocket';

	if (type === 'webrtc') {
		return {
			type,
			...(config.transportRoomId ? { roomId: config.transportRoomId } : {}),
			...(config.signalingServers?.length
				? { signaling: config.signalingServers }
				: {}),
		};
	}

	return { type, url: config.transportUrl };
}

export function recipeToConfigBlock(
	recipe: Recipe,
	enabled: boolean,
): StorageConfigBlock {
	const config = recipe.typeConfig as unknown as StorageTypeConfig;
	return {
		id: config.configId,
		name: recipe.name,
		enabled,
		transportConfig: toBlockTransport(config),
	};
}

export function readStorageTransport(recipe: Recipe): TransportBinding | null {
	const config = recipe.typeConfig as unknown as StorageTypeConfig;
	if (!config) return null;

	return {
		configId: config.configId,
		transport: {
			type: config.transportType ?? 'websocket',
			url: config.transportUrl,
			roomId: config.transportRoomId,
			signaling: config.signalingServers,
		},
	};
}

export function parseStorageImport(raw: string): Recipe {
	const parsed = JSON.parse(raw);
	const block: StorageConfigBlock = Array.isArray(parsed) ? parsed[0] : parsed;
	if (!block || typeof block !== 'object') {
		throw new Error('Paste a TeXlyre storage config block or recipe JSON');
	}

	const transport = block.transportConfig ?? {
		type: 'websocket' as const,
		url: 'ws://localhost:7060',
	};

	const typeConfig: StorageTypeConfig = {
		configId: block.id || nanoid(),
		transportType: transport.type ?? 'websocket',
		transportUrl: transport.url ?? 'ws://localhost:7060',
		transportRoomId: transport.roomId,
		signalingServers: transport.signaling,
	};

	return {
		id: nanoid(),
		type: STORAGE_TYPE,
		name: block.name || block.id || 'Imported Storage',
		env: {},
		modes: [{ kind: 'connect' }],
		selectedMode: 'connect',
		typeConfig: typeConfig as unknown as Record<string, unknown>,
	};
}
