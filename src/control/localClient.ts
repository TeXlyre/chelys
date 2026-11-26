// src/control/localClient.ts
import { invoke } from '@tauri-apps/api/core';

/** The sole desktop command transport. CLI uses the same daemon socket and RPC grammar. */
export function localCommand<T = unknown>(
	method: string,
	params: Record<string, unknown> = {},
): Promise<T> {
	return invoke<T>('instance_rpc', { method, params });
}
