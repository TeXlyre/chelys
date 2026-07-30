// src/plugins/lsp/index.ts
import { getStoredSetting } from '../../config';
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import { withBridgeStart, withBridgeStop } from '../../plugin-host/bridgeHooks';
import { withRouteStart, withRouteStop } from '../../plugin-host/routeHooks';
import type { Recipe } from '../../plugin-host/types';
import { injectLspConfig, removeLspConfig } from './injection';
import {
	LSP_TYPE,
	parseLspImport,
	readLspTransport,
	recipeToConfigBlock,
} from './shared';
import { ltexModule } from './recipes/ltex';

const recipeModules = [ltexModule];

const lspSeeds: Recipe[] = getStoredSetting<boolean>('enableCodedSeeds')
	? recipeModules.map((module) => module.recipe)
	: [];

export function registerLspPlugin(): void {
	pluginTypeRegistry.register({
		type: LSP_TYPE,
		label: 'Language Server',
		icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
		seeds: lspSeeds,
		formSchema: [
			{ key: 'name', label: 'Name', kind: 'text', placeholder: 'LTeX LS Plus' },
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
				help: 'Where the server listens locally',
				placeholder: 'ws://localhost:7020',
			},
			{
				key: 'transportRoomId',
				label: 'Room override',
				kind: 'text',
				help: 'Optional. Defaults to a room derived from your Chelys account.',
			},
			{
				key: 'fileExtensions',
				label: 'File extensions',
				kind: 'list',
				help: 'Comma-separated, e.g. tex, latex, md',
			},
			{
				key: 'clientConfig',
				label: 'Client configuration',
				kind: 'textarea',
				help: 'JSON passed to the language server on start',
			},
		],
		parseImport: parseLspImport,
		toConfigBlock: (recipe) => recipeToConfigBlock(recipe, true),
		onStart: withRouteStart(withBridgeStart(readLspTransport)(injectLspConfig)),
		onStop: withRouteStop(withBridgeStop(readLspTransport)(removeLspConfig)),
	});
}
