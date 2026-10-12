// src/plugins/acp/types.ts
import type { TransportType } from '@chelys/types/transport';

export interface AcpTypeConfig {
	configId: string;
	transportType?: TransportType;
	transportUrl: string;
	transportRoomId?: string;
	signalingServers?: string[];
	cwd?: string;
	mcpServers?: string;
	sessionMeta?: string;
}

export type AcpConfigBlock = {
	id: string;
	name: string;
	enabled: boolean;
	icon?: string;
	transportConfig: {
		type: TransportType;
		url?: string;
		signaling?: string[];
		roomId?: string;
		contentLength: false;
	};
	cwd?: string;
	mcpServers?: string;
	sessionMeta?: string;
};
