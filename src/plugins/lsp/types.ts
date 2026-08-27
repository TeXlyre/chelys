// src/plugins/lsp/types.ts
import type { TransportType } from '@chelys/types/transport';

export interface LspTypeConfig {
	configId: string;
	fileExtensions: string[];
	languageIdMap: Record<string, string>;
	transportType?: TransportType;
	transportUrl: string;
	transportRoomId?: string;
	signalingServers?: string[];
	contentLength: boolean;
	clientConfig: string;
}

export type LspConfigBlock = {
	id: string;
	name: string;
	enabled: boolean;
	icon?: string;
	fileExtensions: string[];
	languageIdMap: Record<string, string>;
	transportConfig: {
		type: TransportType;
		url?: string;
		signaling?: string[];
		roomId?: string;
		contentLength: boolean;
	};
	clientConfig: string;
};
