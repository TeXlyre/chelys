// src/plugins/typesetter/shared.ts
import { nanoid } from 'nanoid';

import type { TransportBinding } from '../../plugin-host/bridgeHooks';
import type { Recipe } from '../../plugin-host/types';
import type { TypesetterConfigBlock, TypesetterTypeConfig } from './types';

export const TYPESETTER_TYPE = 'typesetter';

export interface TypesetterRecipeModule {
	recipe: Recipe;
}

function toBlockTransport(
	config: TypesetterTypeConfig,
): TypesetterConfigBlock['transportConfig'] {
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
): TypesetterConfigBlock {
	const config = recipe.typeConfig as unknown as TypesetterTypeConfig;
	return {
		id: config.configId,
		name: recipe.name,
		enabled,
		...(recipe.icon ? { icon: recipe.icon } : {}),
		incrementalSync: config.incrementalSync,
		projectType: config.projectType,
		projectGroup: config.projectGroup,
		inputExtensions: config.inputExtensions,
		inputFiles: config.inputFiles,
		outputFormats: config.outputFormats,
		transportConfig: toBlockTransport(config),
		capabilities: {
			outline: config.hasOutline,
			formatter: config.formatter,
		},
		ui: config.ui,
	};
}

export function readTypesetterTransport(
	recipe: Recipe,
): TransportBinding | null {
	const config = recipe.typeConfig as unknown as TypesetterTypeConfig;
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

export function parseTypesetterImport(raw: string): Recipe {
	const parsed = JSON.parse(raw);
	const block: TypesetterConfigBlock = Array.isArray(parsed)
		? parsed[0]
		: parsed;
	if (!block || typeof block !== 'object') {
		throw new Error('Paste a TeXlyre typesetter config block or recipe JSON');
	}

	const transport = block.transportConfig ?? {
		type: 'websocket' as const,
		url: 'ws://localhost:7040',
	};

	const typeConfig: TypesetterTypeConfig = {
		configId: block.id || nanoid(),
		projectType: block.projectType || 'custom',
		projectGroup: block.projectGroup,
		inputExtensions: block.inputExtensions ?? [],
		inputFiles: block.inputFiles ?? [],
		outputFormats: block.outputFormats ?? [],
		transportType: transport.type ?? 'websocket',
		transportUrl: transport.url,
		transportRoomId: transport.roomId,
		signalingServers: transport.signaling,
		incrementalSync: block.incrementalSync,
		formatter: block.capabilities?.formatter,
		hasOutline: block.capabilities?.outline,
		ui: block.ui,
	};

	return {
		id: nanoid(),
		type: TYPESETTER_TYPE,
		name: block.name || block.id || 'Imported Typesetter',
		env: {},
		modes: [{ kind: 'connect' }],
		selectedMode: 'connect',
		typeConfig: typeConfig as unknown as Record<string, unknown>,
	};
}
