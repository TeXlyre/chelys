// src/plugins/storage/index.ts
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import { withBridgeStart, withBridgeStop } from '../../plugin-host/bridgeHooks';
import { withRouteStart, withRouteStop } from '../../plugin-host/routeHooks';
import { injectStorageConfig, removeStorageConfig } from './injection';
import {
	STORAGE_TYPE,
	parseStorageImport,
	readStorageTransport,
	recipeToConfigBlock,
} from './shared';

export function registerStoragePlugin(): void {
	pluginTypeRegistry.register({
		type: STORAGE_TYPE,
		exclusive: true,
		label: 'Storage',
		icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg>',
		seeds: [],
		formSchema: [
			{ key: 'name', label: 'Name', kind: 'text', placeholder: 'Storage' },
			{
				key: 'transportType',
				label: 'Transport',
				kind: 'text',
				help: 'websocket, or webrtc to reach this over a peer connection',
				placeholder: 'websocket',
			},
			{
				key: 'transportUrl',
				label: 'WebSocket URL',
				kind: 'text',
				help: 'Where the storage bridge listens locally',
				placeholder: 'ws://localhost:7060',
			},
			{
				key: 'transportRoomId',
				label: 'Room override',
				kind: 'text',
				help: 'Optional. Defaults to a room derived from your Chelys account.',
			},
		],
		parseImport: parseStorageImport,
		toConfigBlock: (recipe) => recipeToConfigBlock(recipe, true),
		onStart: withRouteStart(
			withBridgeStart(readStorageTransport)(injectStorageConfig),
		),
		onStop: withRouteStop(
			withBridgeStop(readStorageTransport)(removeStorageConfig),
		),
	});
}
