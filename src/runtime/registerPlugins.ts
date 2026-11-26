// src/runtime/registerPlugins.ts
import { registerAcpPlugin } from '../plugins/acp';
import { registerLspPlugin } from '../plugins/lsp';
import { registerTypesetterPlugin } from '../plugins/typesetter';
import { registerInfrastructurePlugin } from '../plugins/infrastructure';
import { registerStoragePlugin } from '../plugins/storage';

import { registerServicePlugin } from '../plugins/service';
import { registerEndpointPlugin } from '../plugins/endpoint';

let initialized = false;
export function registerChelysPlugins(): void {
	if (initialized) return;
	registerLspPlugin();
	registerTypesetterPlugin();
	registerStoragePlugin();
	registerInfrastructurePlugin();
	registerAcpPlugin();
	registerEndpointPlugin();
	registerServicePlugin();
	initialized = true;
}
