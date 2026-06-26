// src/hooks/useAccountStore.ts
import { useEffect, useState } from 'react';

export const useAccountStore = (
	roomId: string | null,
	store: 'settings' | 'properties' | 'records' | 'secrets',
): string => {
	const [raw, setRaw] = useState('{}');

	useEffect(() => {
		if (!roomId) return;
		const storageKey = `texlyre-user-${roomId}-${store}`;
		const refresh = () => setRaw(localStorage.getItem(storageKey) ?? '{}');
		refresh();

		const handler = (event: Event) => {
			const detail = (event as CustomEvent).detail;
			if (!detail || detail.store === store) {
				refresh();
			}
		};

		window.addEventListener('chelys-account-store-changed', handler);
		return () =>
			window.removeEventListener('chelys-account-store-changed', handler);
	}, [roomId, store]);

	return raw;
};
