// src/plugin-host/bridgeHooks.ts
import { bridgeRegistry } from "../peer/BridgeRegistry";
import type { TransportConfig } from "@chelys/types/transport";
import type { Recipe } from "./types";

type Hook = (recipe: Recipe) => void;

export interface TransportBinding {
	configId: string;
	transport: TransportConfig;
}

export type TransportConfigReader = (
	recipe: Recipe,
) => TransportBinding | null;

export const withBridgeStart =
	(readTransport: TransportConfigReader) =>
	(inner: Hook): Hook =>
	(recipe) => {
		inner(recipe);
		const binding = readTransport(recipe);
		if (binding) {
			bridgeRegistry.start(
				recipe.id,
				binding.configId,
				`${recipe.type}:${binding.configId}`,
				binding.transport,
			);
		}
	};

export const withBridgeStop =
	(_readTransport: TransportConfigReader) =>
	(inner: Hook): Hook =>
	(recipe) => {
		inner(recipe);
		bridgeRegistry.stop(recipe.id);
	};
