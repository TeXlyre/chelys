// src/peer/BridgeRegistry.ts
import { RecipeBridge, bridgeOptionsFromConfig } from "./RecipeBridge";
import type { TransportConfig } from "@chelys/types/transport";

interface BridgeEntry {
	bridge: RecipeBridge;
	signature: string;
}

const bridgeSignature = (
	options: NonNullable<ReturnType<typeof bridgeOptionsFromConfig>>,
): string =>
	JSON.stringify({
		label: options.label,
		roomId: options.roomId,
		accountRoomId: options.accountRoomId,
		signaling: [...options.signaling].sort(),
		targetUrl: options.targetUrl,
	});

class BridgeRegistry {
	private readonly bridges = new Map<string, BridgeEntry>();

	start(
		recipeId: string,
		configId: string,
		label: string,
		config: TransportConfig,
	): void {
		const options = bridgeOptionsFromConfig(recipeId, configId, label, config);
		if (!options) {
			this.stop(recipeId);
			return;
		}

		const signature = bridgeSignature(options);
		const existing = this.bridges.get(recipeId);
		if (existing?.signature === signature) return;
		if (existing) this.stop(recipeId);

		const bridge = new RecipeBridge(options);
		bridge.start();
		this.bridges.set(recipeId, { bridge, signature });
	}

	stop(recipeId: string): void {
		const entry = this.bridges.get(recipeId);
		if (!entry) return;
		this.bridges.delete(recipeId);
		entry.bridge.stop();
	}

	stopAll(): void {
		for (const { bridge } of this.bridges.values()) bridge.stop();
		this.bridges.clear();
	}
}

export const bridgeRegistry = new BridgeRegistry();
