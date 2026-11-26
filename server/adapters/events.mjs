// server/adapters/events.mjs
const handlers = new Map();
export async function listen(name, handler) {
	if (!handlers.has(name)) handlers.set(name, new Set());
	handlers.get(name).add(handler);
	return () => handlers.get(name)?.delete(handler);
}
export function emit(name, payload) {
	for (const handler of handlers.get(name) || []) {
		try {
			handler({ event: name, payload });
		} catch (error) {
			console.error('[Chelys] Event callback:', error);
		}
	}
}
