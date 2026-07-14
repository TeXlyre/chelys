import type { TypesetterUISchema } from './uiSchema';

export interface TypesetterOutputFormat {
	id: string;
	mimeType: string;
	rendererPluginId?: string;
	outputType?: string;
}

export interface TypesetterTypeConfig {
	configId: string;
	projectType: string;
	inputExtensions: string[];
	outputFormats: TypesetterOutputFormat[];
	transportType: 'websocket' | 'webrtc';
	transportUrl?: string;
	signalingServers?: string[];
	roomId?: string;
	formatter?: string;
	hasOutline?: boolean;
	ui?: TypesetterUISchema;
}

export interface TypesetterConfigBlock {
	id: string;
	name: string;
	enabled: boolean;
	projectType: string;
	inputExtensions: string[];
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
