// src/plugins/lsp/types.ts
export interface LspTypeConfig {
	configId: string;
	fileExtensions: string[];
	languageIdMap: Record<string, string>;
	transportUrl: string;
	contentLength: boolean;
	clientConfig: string;
}

export interface LspConfigBlock {
	id: string;
	name: string;
	enabled: boolean;
	fileExtensions: string[];
	languageIdMap: Record<string, string>;
	transportConfig: {
		type: 'websocket';
		url: string;
		contentLength: boolean;
	};
	clientConfig: string;
}
