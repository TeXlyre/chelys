// chelys.config.ts
export interface ChelysConfig {
	productName: string;
	userdata: {
		version: string;
		default: {
			settings: Record<string, unknown>;
		};
	};
}

const config: ChelysConfig = {
	productName: 'Chelys',
	userdata: {
		version: '0.1.0',
		default: {
			settings: {
				recipeRegistryUrl:
					'https://texlyre.github.io/chelys-recipes/api/recipes.json',
				enableCodedSeeds: false,
				collabSignalingServers: 'wss://ywebrtc.texlyre.org',
				collabAutoReconnect: true,
				closeBehavior: 'tray',
				startOnBoot: false,
				recipePlatformOverride: 'auto',
				dynamicPortFallback: true,
				defaultContainerEngine: 'docker',
				podmanUnqualifiedSearchRegistries: 'docker.io',
				serviceHost: 'localhost',
				texlyreBaseUrl: 'https://texlyre.org/texlyre',
				traefikEnabled: false,
				traefikBaseUrl: 'ws://localhost:8000',
				traefikBackendHost: 'auto',
				traefikRouteServerPort: 8099,
			},
		},
	},
};

export default config;
