export type UnlistenFn = () => void;

type Handler = (event: { payload: unknown }) => void;

const listeners = new Map<string, Set<Handler>>();

export async function listen<T>(
    event: string,
    handler: (payload: { payload: T }) => void,
): Promise<UnlistenFn> {
    const bucket = listeners.get(event) ?? new Set<Handler>();
    bucket.add(handler as Handler);
    listeners.set(event, bucket);
    return () => bucket.delete(handler as Handler);
}

export function emitTauriEvent(event: string, payload: unknown): void {
    for (const handler of listeners.get(event) ?? []) handler({ payload });
}

export function resetTauriEvent(): void {
    listeners.clear();
}
