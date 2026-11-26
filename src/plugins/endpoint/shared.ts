// src/plugins/endpoint/shared.ts
import type { TransportBinding } from '../../plugin-host/bridgeHooks';
import type { Recipe } from '../../plugin-host/types';
import { instanceRecipeId } from '../service/shared';

export const ENDPOINT_TYPE = 'endpoint';
export function readEndpointTransport(
	recipe: Recipe,
	instance: string,
): TransportBinding | null {
	const config = recipe.typeConfig;
	const type = config.transportType ?? 'websocket';
	if (
		typeof config.protocol !== 'string' ||
		!config.protocol.trim() ||
		(type !== 'websocket' && type !== 'webrtc') ||
		typeof config.transportUrl !== 'string'
	)
		return null;
	if (
		config.transportRoomId !== undefined &&
		typeof config.transportRoomId !== 'string'
	)
		return null;
	if (
		config.signalingServers !== undefined &&
		(!Array.isArray(config.signalingServers) ||
			config.signalingServers.some((value) => typeof value !== 'string'))
	)
		return null;
	try {
		const url = new URL(config.transportUrl);
		if (
			!['ws:', 'wss:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.hash ||
			url.search
		)
			return null;
	} catch {
		return null;
	}
	return {
		configId: instanceRecipeId(instance, recipe.id),
		transport: {
			type: type as 'websocket' | 'webrtc',
			url: config.transportUrl,
			roomId: config.transportRoomId as string | undefined,
			signaling: config.signalingServers as string[] | undefined,
		},
	};
}
export function endpointDescriptor(recipe: Recipe, instance: string) {
	const binding = readEndpointTransport(recipe, instance);
	if (!binding)
		throw Error(
			'Endpoint requires a protocol and credential-free WebSocket URL',
		);
	const { type, url, roomId, signaling } = binding.transport;
	return {
		id: binding.configId,
		recipeId: recipe.id,
		instanceId: instance,
		name: recipe.name,
		protocol: recipe.typeConfig.protocol,
		...(Array.isArray(recipe.typeConfig.providers)
			? {
					providers: recipe.typeConfig.providers.filter(
						(value) => typeof value === 'string',
					),
				}
			: {}),
		enabled: true,
		transportConfig:
			type === 'webrtc'
				? {
						type,
						...(roomId ? { roomId } : {}),
						...(signaling?.length ? { signaling } : {}),
					}
				: { type, url },
	};
}
