// src/plugins/service/shared.ts
import type { TransportBinding } from '../../plugin-host/bridgeHooks';
import type { Recipe } from '../../plugin-host/types';

export const SERVICE_TYPE = 'service';
export const SERVICE_CONFIG_PREFIX = 'generic-service-config:';

type ServiceTypeConfig = {
	configId?: string;
	protocol?: string;
	transportType?: 'websocket' | 'webrtc';
	transportUrl?: string;
	transportRoomId?: string;
	signalingServers?: string[];
};

export const serviceConfigKey = (configId: string): string =>
	`${SERVICE_CONFIG_PREFIX}${configId}`;

export function readServiceTransport(recipe: Recipe): TransportBinding | null {
	const config = recipe.typeConfig as ServiceTypeConfig;
	const type = config.transportType ?? 'websocket';
	if (
		typeof config.configId !== 'string' ||
		!/^[a-zA-Z0-9_.-]+$/.test(config.configId) ||
		typeof config.protocol !== 'string' ||
		!config.protocol.trim() ||
		(type !== 'websocket' && type !== 'webrtc') ||
		typeof config.transportUrl !== 'string'
	) {
		return null;
	}

	try {
		const url = new URL(config.transportUrl);
		if (
			(url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
			url.username ||
			url.password
		) {
			return null;
		}
	} catch {
		return null;
	}

	return {
		configId: config.configId,
		transport: {
			type,
			url: config.transportUrl,
			roomId: config.transportRoomId,
			signaling: config.signalingServers,
		},
	};
}

export function recipeToConfigBlock(recipe: Recipe, enabled: boolean) {
	const config = recipe.typeConfig as ServiceTypeConfig;
	const binding = readServiceTransport(recipe);
	const transport = binding?.transport;
	return {
		id: config.configId ?? '',
		name: recipe.name,
		protocol: config.protocol ?? '',
		enabled: enabled && !!binding,
		transportConfig:
			config.transportType === 'webrtc'
				? {
						type: 'webrtc' as const,
						...(transport?.roomId ? { roomId: transport.roomId } : {}),
						...(transport?.signaling?.length
							? { signaling: transport.signaling }
							: {}),
					}
				: { type: 'websocket' as const, url: transport?.url },
	};
}
