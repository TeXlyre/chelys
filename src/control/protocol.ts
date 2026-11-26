// src/control/protocol.ts
export const CONTROL_LABEL_PREFIX = 'chelys-control:';
export const RPC_VERSION = 1;
export interface RpcRequest {
	v: 1;
	id: string;
	method: string;
	params?: Record<string, unknown>;
	apiKey?: string;
}
export interface RpcResponse {
	v: 1;
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
}
export function parseRequest(message: string): RpcRequest {
	if (message.length > 2_097_152) throw new Error('Request too large');
	const request: unknown = JSON.parse(message);
	if (!request || typeof request !== 'object' || Array.isArray(request))
		throw new Error('Invalid request');
	const value = request as Partial<RpcRequest>;
	if (
		value.v !== 1 ||
		typeof value.id !== 'string' ||
		!/^[a-zA-Z0-9-]{1,64}$/.test(value.id) ||
		typeof value.method !== 'string' ||
		value.method.length > 100
	) {
		throw new Error('Invalid RPC envelope');
	}
	return value as RpcRequest;
}
export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
export async function handleRpc(
	message: string,
	handler: (request: RpcRequest) => Promise<unknown>,
): Promise<RpcResponse> {
	let id = 'invalid';
	try {
		const request = parseRequest(message);
		id = request.id;
		return { v: 1, id, ok: true, result: await handler(request) };
	} catch (error) {
		return { v: 1, id, ok: false, error: errorText(error) };
	}
}

export function getInstanceId(): string {
	let id = localStorage.getItem('chelys-instance-id');
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem('chelys-instance-id', id);
	}
	return id;
}
