// src/plugins/service/index.ts
import { getUserData, setUserData } from '@texlyre/utils/userDataUtils';
import { getActiveAccountId } from '../../plugin-host/activeAccount';
import { withBridgeStart, withBridgeStop } from '../../plugin-host/bridgeHooks';
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import { withRouteStart, withRouteStop } from '../../plugin-host/routeHooks';
import type { Recipe } from '../../plugin-host/types';
import {
	SERVICE_TYPE,
	readServiceTransport,
	recipeToConfigBlock,
	serviceConfigKey,
} from './shared';

function publishServiceConfig(recipe: Recipe): void {
	const binding = readServiceTransport(recipe);
	if (!binding) {
		throw new Error('Service requires a configuration ID, protocol and WebSocket URL');
	}
	const userId = getActiveAccountId();
	if (!userId) return;
	const settings = getUserData<Record<string, unknown>>(userId, 'settings') ?? {};
	const key = serviceConfigKey(binding.configId);
	setUserData(userId, 'settings', {
		...settings,
		[key]: recipeToConfigBlock(recipe, true),
	});
}

function removeServiceConfig(recipe: Recipe): void {
	const userId = getActiveAccountId();
	const configId = recipe.typeConfig.configId;
	if (!userId || typeof configId !== 'string') return;
	const settings = getUserData<Record<string, unknown>>(userId, 'settings') ?? {};
	const key = serviceConfigKey(configId);
	if (!(key in settings)) return;
	delete settings[key];
	setUserData(userId, 'settings', settings);
}

export function registerServicePlugin(): void {
	pluginTypeRegistry.register({
		type: SERVICE_TYPE,
		label: 'Service',
		icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/></svg>',
		seeds: [],
		formSchema: [
			{ key: 'name', label: 'Name', kind: 'text', placeholder: 'Service' },
			{
				key: 'configId',
				label: 'Configuration ID',
				kind: 'text',
				help: 'Stable ID, unique within your account across machines.',
				placeholder: 'service-host-01',
			},
			{
				key: 'protocol',
				label: 'Protocol',
				kind: 'text',
				help: 'Protocol identifier used by the client.',
				placeholder: 'example/1',
			},
			{
				key: 'transportType',
				label: 'Transport',
				kind: 'text',
				placeholder: 'websocket',
				help: 'websocket or webrtc',
			},
			{
				key: 'transportUrl',
				label: 'WebSocket URL',
				kind: 'text',
				placeholder: 'ws://127.0.0.1:9070',
			},
			{
				key: 'transportRoomId',
				label: 'Room override',
				kind: 'text',
				help: 'Optional. Defaults to a room derived from your Chelys account.',
			},
			{
				key: 'signalingServers',
				label: 'Signaling servers',
				kind: 'list',
			},
		],
		toConfigBlock: (recipe) => recipeToConfigBlock(recipe, true),
		onStart: withRouteStart(
			withBridgeStart(readServiceTransport)(publishServiceConfig),
		),
		onStop: withRouteStop(
			withBridgeStop(readServiceTransport)(removeServiceConfig),
		),
	});
}
