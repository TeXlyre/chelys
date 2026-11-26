// src/runtime/collaborationSettings.ts
export function synchronizeCollaborationSettings(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	roomId: string,
	signaling: string,
	autoReconnect: boolean,
): void {
	const key = `texlyre-user-${roomId}-settings`;
	const raw = storage.getItem(key);
	const existing: unknown = raw ? JSON.parse(raw) : {};
	if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
		throw new Error('Invalid TeXlyre account settings');
	}
	const settings = existing as Record<string, unknown>;
	if (
		settings['collab-signaling-servers'] === signaling &&
		settings['collab-auto-reconnect'] === autoReconnect
	)
		return;
	storage.setItem(
		key,
		JSON.stringify({
			...settings,
			'collab-signaling-servers': signaling,
			'collab-auto-reconnect': autoReconnect,
		}),
	);
}
