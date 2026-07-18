// src/plugins/typesetter/types.ts
import type { TranslatableText, TypesetterUISchema } from './uiSchema';

export interface TypesetterOutputFormat {
	id: string;
	mimeType: string;
	rendererPluginId?: string;
	outputType?: string;
}

export interface TypesetterInputFile {
	extension: string;
	label?: TranslatableText;
	mimeType?: string;
}

export interface TypesetterTypeConfig {
	configId: string;
	projectType: string;
	projectGroup?: string;
	inputExtensions: string[];
	inputFiles?: TypesetterInputFile[];
	outputFormats: TypesetterOutputFormat[];
	transportType: 'websocket' | 'webrtc';
	transportUrl?: string;
	signalingServers?: string[];
	roomId?: string;
	incrementalSync?: boolean;
	formatter?: string;
	hasOutline?: boolean;
	ui?: TypesetterUISchema;
}

export interface TypesetterConfigBlock {
	id: string;
	name: string;
	enabled: boolean;
	incrementalSync?: boolean;
	projectType: string;
	projectGroup?: string;
	inputExtensions: string[];
	inputFiles?: TypesetterInputFile[];
	outputFormats: TypesetterOutputFormat[];
	transportConfig: {
		type: 'websocket' | 'webrtc';
		url?: string;
		signaling?: string[];
		roomId?: string;
	};
	capabilities: {
		outline?: boolean;
		formatter?: string;
	};
	ui?: TypesetterUISchema;
}
