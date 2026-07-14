// src/plugins/typesetter/index.ts
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import { injectTypesetterConfig, removeTypesetterConfig } from './injection';
import { TYPESETTER_TYPE, parseTypesetterImport } from './shared';

export function registerTypesetterPlugin(): void {
	pluginTypeRegistry.register({
		type: TYPESETTER_TYPE,
		label: 'Typesetter',
		icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>',
		seeds: [],
		formSchema: [
			{ key: 'name', label: 'Name', kind: 'text', placeholder: 'SILE' },
			{
				key: 'projectType',
				label: 'Project type',
				kind: 'text',
				help: 'Identifier TeXlyre uses to select this compiler',
				placeholder: 'sile',
			},
			{
				key: 'transportUrl',
				label: 'WebSocket URL',
				kind: 'text',
				help: 'Where TeXlyre connects to this compiler',
				placeholder: 'ws://localhost:7040',
			},
			{
				key: 'inputExtensions',
				label: 'Input extensions',
				kind: 'list',
				help: 'Comma-separated, e.g. sil, xml',
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
		onStart: injectTypesetterConfig,
		onStop: removeTypesetterConfig,
	});
}
