// src/peer/BridgeResolution.ts
import { getStoredSetting } from "../config";
import { getActiveAccountId } from "../plugin-host/activeAccount";

export function resolveTransportRoomId(
	configId: string,
	explicit?: string,
): string | null {
	if (explicit) return explicit;

	const accountId = getActiveAccountId();
	return accountId ? `${accountId}:${configId}` : null;
}

export function resolveSignalingServers(explicit?: string[]): string[] {
	if (explicit?.length) return explicit;

	return getStoredSetting<string>("collabSignalingServers")
		.split(",")
		.map((server) => server.trim())
		.filter(Boolean);
}
