// src/plugins/typesetter/index.ts
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import { withBridgeStart, withBridgeStop } from '../../plugin-host/bridgeHooks';
import { withRouteStart, withRouteStop } from '../../plugin-host/routeHooks';
import { injectTypesetterConfig, removeTypesetterConfig } from './injection';
import {
	TYPESETTER_TYPE,
	parseTypesetterImport,
	readTypesetterTransport,
	recipeToConfigBlock,
} from './shared';

export function registerTypesetterPlugin(): void {
	pluginTypeRegistry.register({
		type: TYPESETTER_TYPE,
		label: 'Typesetter',
		icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>',
		seeds: [],
		formSchema: [
			{ key: 'name', label: 'Name', kind: 'text', placeholder: 'TeX' },
			{
				key: 'projectType',
				label: 'Project type',
				kind: 'text',
				help: 'Identifier TeXlyre uses to select this compiler',
				placeholder: 'latex',
			},
			{
				key: 'projectGroup',
				label: 'Project group',
				kind: 'text',
				help: 'Optional compiler family shown in TeXlyre and defaults to the project type',
				placeholder: 'tex',
			},
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
				help: 'Where the compiler listens locally',
				placeholder: 'ws://localhost:7040',
			},
			{
				key: 'transportRoomId',
				label: 'Room override',
				kind: 'text',
				help: 'Optional. Defaults to a room derived from your Chelys account.',
			},
			{
				key: 'inputExtensions',
				label: 'Input extensions',
				kind: 'list',
				help: 'Comma-separated, e.g. sil, xml',
			},
			{
				key: 'incrementalSync',
				label: 'Incremental sync',
				kind: 'boolean',
				help: 'Send only changed files. Requires a compiler that reconciles the file manifest.',
			},
			{
				key: 'outputFormats',
				label: 'Output formats',
				kind: 'textarea',
				help: 'JSON array of { id, mimeType, rendererPluginId }',
			},
			{
				key: 'ui',
				label: 'Compile/export UI schema',
				kind: 'textarea',
				help: 'JSON describing compile and export option fields',
			},
		],
		parseImport: parseTypesetterImport,
		toConfigBlock: (recipe) => recipeToConfigBlock(recipe, true),
		onStart: withRouteStart(
			withBridgeStart(readTypesetterTransport)(injectTypesetterConfig),
		),
		onStop: withRouteStop(
			withBridgeStop(readTypesetterTransport)(removeTypesetterConfig),
		),
	});
}
