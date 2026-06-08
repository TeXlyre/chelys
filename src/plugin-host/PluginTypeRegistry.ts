// src/plugin-host/PluginTypeRegistry.ts
import type { PluginTypeDefinition, Recipe } from './types';

class PluginTypeRegistry {
	private types = new Map<string, PluginTypeDefinition>();

	register(definition: PluginTypeDefinition): void {
		this.types.set(definition.type, definition);
	}

	get(type: string): PluginTypeDefinition | undefined {
		return this.types.get(type);
	}

	list(): PluginTypeDefinition[] {
		return Array.from(this.types.values());
	}

	seeds(): Recipe[] {
		return this.list().flatMap((definition) => definition.seeds);
	}
}

export const pluginTypeRegistry = new PluginTypeRegistry();
