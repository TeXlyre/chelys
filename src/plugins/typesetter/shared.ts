// src/plugins/typesetter/shared.ts
import { nanoid } from 'nanoid';

import type { Recipe } from '../../plugin-host/types';
import type { TypesetterConfigBlock, TypesetterTypeConfig } from './types';

export const TYPESETTER_TYPE = 'typesetter';

export interface TypesetterRecipeModule {
	recipe: Recipe;
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
		incrementalSync: config.incrementalSync,
		projectType: config.projectType,
		inputExtensions: config.inputExtensions,
		inputFiles: config.inputFiles,
		outputFormats: config.outputFormats,
		transportConfig: {
			type: config.transportType,
			url: config.transportUrl,
			signaling: config.signalingServers,
			roomId: config.roomId,
		},
		capabilities: {
			outline: config.hasOutline,
			formatter: config.formatter,
		},
		ui: config.ui,
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
		inputExtensions: block.inputExtensions ?? [],
		inputFiles: block.inputFiles ?? [],
		outputFormats: block.outputFormats ?? [],
		transportType: transport.type,
		transportUrl: transport.url,
		signalingServers: transport.signaling,
		roomId: transport.roomId,
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
