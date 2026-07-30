// src/plugins/typesetter/types.ts
import type { TransportType } from '@chelys/types/transport';
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
	transportType?: TransportType;
	transportUrl?: string;
	transportRoomId?: string;
	signalingServers?: string[];
	incrementalSync?: boolean;
	formatter?: string;
	hasOutline?: boolean;
	ui?: TypesetterUISchema;
}

export interface TypesetterConfigBlock {
	id: string;
	name: string;
	enabled: boolean;
	icon?: string;
	incrementalSync?: boolean;
	projectType: string;
	projectGroup?: string;
	inputExtensions: string[];
	inputFiles?: TypesetterInputFile[];
	outputFormats: TypesetterOutputFormat[];
	transportConfig: {
		type: TransportType;
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
