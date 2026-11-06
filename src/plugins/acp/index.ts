// src/plugins/acp/index.ts
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import { withBridgeStart, withBridgeStop } from '../../plugin-host/bridgeHooks';
import { withRouteStart, withRouteStop } from '../../plugin-host/routeHooks';
import { injectAcpConfig, removeAcpConfig } from './injection';
import {
	ACP_TYPE,
	parseAcpImport,
	readAcpTransport,
	recipeToConfigBlock,
} from './shared';

export function registerAcpPlugin(): void {
	pluginTypeRegistry.register({
		type: ACP_TYPE,
		label: 'Agent',
		icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/></svg>',
		seeds: [],
		formSchema: [
			{ key: 'name', label: 'Name', kind: 'text', placeholder: 'Claude Agent' },
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
				help: 'Where the line-mode ACP proxy listens locally',
				placeholder: 'ws://localhost:7060',
			},
			{
				key: 'transportRoomId',
				label: 'Room override',
				kind: 'text',
				help: 'Optional. Defaults to a room derived from your Chelys account.',
			},
			{
				key: 'cwd',
				label: 'Session directory',
				kind: 'text',
				help: 'Optional. Absolute path TeXlyre reports as the session cwd; project files are mapped beneath it.',
			},
			{
				key: 'mcpServers',
				label: 'MCP servers',
				kind: 'textarea',
				help: 'Optional JSON array of ACP McpServer entries passed to session/new',
			},
			{
				key: 'sessionMeta',
				label: 'Session options',
				kind: 'textarea',
				help: 'Optional JSON object sent as _meta on session/new, for agent-specific options',
			},
		],
		parseImport: parseAcpImport,
		toConfigBlock: (recipe) => recipeToConfigBlock(recipe, true),
		onStart: withRouteStart(withBridgeStart(readAcpTransport)(injectAcpConfig)),
		onStop: withRouteStop(withBridgeStop(readAcpTransport)(removeAcpConfig)),
	});
}
