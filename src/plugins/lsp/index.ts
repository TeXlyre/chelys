// src/plugins/lsp/index.ts
import { getStoredSetting } from '../../config';
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import type { Recipe } from '../../plugin-host/types';
import { injectLspConfig, removeLspConfig } from './injection';
import { LSP_TYPE, parseLspImport } from './shared';
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
				key: 'transportUrl',
				label: 'WebSocket URL',
				kind: 'text',
				help: 'Where TeXlyre connects to this server',
				placeholder: 'ws://localhost:7020',
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
		onStart: injectLspConfig,
		onStop: removeLspConfig,
	});
}
