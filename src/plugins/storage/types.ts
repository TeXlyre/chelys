// src/plugins/storage/types.ts
import type { TransportType } from '@chelys/types/transport';

export interface StorageTypeConfig {
	configId: string;
	transportType?: TransportType;
	transportUrl: string;
	transportRoomId?: string;
	signalingServers?: string[];
}

export interface StorageConfigBlock {
	id: string;
	name: string;
	enabled: boolean;
	transportConfig: {
		type: TransportType;
		url?: string;
		signaling?: string[];
		roomId?: string;
	};
}
