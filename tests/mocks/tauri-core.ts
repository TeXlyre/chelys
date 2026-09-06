export type InvokeHandler = (payload: unknown) => unknown;

export interface InvokeCall {
    cmd: string;
    payload: unknown;
}

const handlers = new Map<string, InvokeHandler>();

export const invokeCalls: InvokeCall[] = [];

export class Channel<T = unknown> {
    onmessage: (message: T) => void = () => undefined;
}

export function invoke<T = unknown>(
    cmd: string,
    payload?: unknown,
): Promise<T> {
    const delivered =
        payload instanceof Uint8Array ? payload.slice() : payload;
    invokeCalls.push({ cmd, payload: delivered });

    const handler = handlers.get(cmd);
    if (!handler) return Promise.resolve(undefined as T);
    return Promise.resolve()
        .then(() => handler(delivered))
        .then((result) => result as T);
}

export function setInvokeHandler(cmd: string, handler: InvokeHandler): void {
    handlers.set(cmd, handler);
}

export function callsFor(cmd: string): InvokeCall[] {
    return invokeCalls.filter((call) => call.cmd === cmd);
}

export function resetTauriCore(): void {
    handlers.clear();
    invokeCalls.length = 0;
}
