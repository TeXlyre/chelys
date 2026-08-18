// src/plugin-host/recipeSharing.ts
import { nanoid } from 'nanoid';

import { pluginTypeRegistry } from './PluginTypeRegistry';
import type { Recipe } from './types';
import { resolveRecipe } from './variableResolution';

export type RecipeShareState = 'ready' | 'warning' | 'blocked';

export type ShareMode = 'websocket' | 'webrtc-room' | 'webrtc-account';

export interface RecipeShareInfo {
	json: string | null;
	fileName: string;
	transportType: string;
	state: RecipeShareState;
	message?: string;
}

interface SharedTransportConfig {
	transportType?: unknown;
	transportUrl?: unknown;
	transportRoomId?: unknown;
}

const LOOPBACK_HOSTS = new Set([
	'localhost',
	'127.0.0.1',
	'0.0.0.0',
	'::1',
	'[::1]',
]);

const isLoopbackUrl = (url: unknown): boolean => {
	if (typeof url !== 'string' || !url.trim()) return false;

	const authority = url.replace(/^[a-z]+:\/\//i, '').split('/')[0];
	const host = authority.startsWith('[')
		? authority.slice(0, authority.indexOf(']') + 1)
		: authority.split(':')[0];

	return LOOPBACK_HOSTS.has(host.toLowerCase());
};

const text = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() ? value.trim() : null;

export function describeRecipeShare(recipe: Recipe): RecipeShareInfo {
	const build = pluginTypeRegistry.get(recipe.type)?.toConfigBlock;
	const fileName = `${recipe.id || recipe.type}.json`;

	if (!build) {
		return {
			json: null,
			fileName,
			transportType: '',
			state: 'blocked',
			message:
				'This recipe type does not publish a TeXlyre configuration block.',
		};
	}

	const resolved = resolveRecipe(recipe);
	const config = resolved.typeConfig as SharedTransportConfig;
	const transportType = text(config.transportType) ?? 'websocket';
	const roomId = text(config.transportRoomId);
	const json = JSON.stringify(build(resolved), null, 2);

	if (transportType === 'webrtc' && !roomId) {
		return {
			json,
			fileName,
			transportType,
			state: 'blocked',
			message:
				'This recipe uses a WebRTC room derived from your Chelys account. Anyone you send it to would resolve their own account room instead of yours, so it cannot reach this server. Set a room override to make it shareable.',
		};
	}

	if (transportType !== 'webrtc' && isLoopbackUrl(config.transportUrl)) {
		return {
			json,
			fileName,
			transportType,
			state: 'warning',
			message:
				'The server URL resolves only on this machine. Collaborators need a reachable host or a Traefik route before this configuration works for them.',
		};
	}

	return { json, fileName, transportType, state: 'ready' };
}

export function readShareMode(recipe: Recipe): ShareMode {
	const config = recipe.typeConfig as SharedTransportConfig;

	if (text(config.transportType) !== 'webrtc') return 'websocket';

	return text(config.transportRoomId) ? 'webrtc-room' : 'webrtc-account';
}

export function applyShareMode(recipe: Recipe, mode: ShareMode): Recipe {
	const typeConfig = { ...recipe.typeConfig };

	if (mode === 'websocket') {
		typeConfig.transportType = 'websocket';
		delete typeConfig.transportRoomId;
	} else if (mode === 'webrtc-account') {
		typeConfig.transportType = 'webrtc';
		delete typeConfig.transportRoomId;
	} else {
		const configId = text(typeConfig.configId) ?? recipe.id;
		typeConfig.transportType = 'webrtc';
		typeConfig.transportRoomId =
			text(typeConfig.transportRoomId) ?? `${configId}-${nanoid(10)}`;
	}

	return { ...recipe, typeConfig };
}
