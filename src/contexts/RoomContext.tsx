// src/contexts/RoomContext.tsx
import type React from 'react';
import { type ReactNode, createContext, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { deriveIdentity, fromHex, type DerivedIdentity } from '@chelys/protocol';
import { chelysAccountSyncService } from '@texlyre/services/ChelysAccountSyncService';
import { type RoomDefaults, getStoredSetting } from '../config';
import { setActiveAccountId } from '../plugin-host/activeAccount';

interface StoredCredentials {
	username: string;
	password: string;
	prf_output_hex: string;
}

interface RoomCredentials {
	username: string;
	password: string;
	prfHex: string;
}

interface RoomContextType {
	identity: DerivedIdentity | null;
	username: string;
	credentials: RoomCredentials | null;
	isInitializing: boolean;
	login: (username: string, password: string, prfHex: string) => Promise<void>;
	updateCredentials: (next: RoomCredentials) => Promise<void>;
	logout: () => Promise<void>;
}

export const RoomContext = createContext<RoomContextType>({
	identity: null,
	username: '',
	credentials: null,
	isInitializing: true,
	login: async () => {
		throw new Error('Not implemented');
	},
	updateCredentials: async () => {
		throw new Error('Not implemented');
	},
	logout: async () => {
		throw new Error('Not implemented');
	},
});

export const RoomProvider: React.FC<{
	children: ReactNode;
	defaults: RoomDefaults;
}> = ({ children }) => {
	const [identity, setIdentity] = useState<DerivedIdentity | null>(null);
	const [username, setUsername] = useState('');
	const [credentials, setCredentials] = useState<RoomCredentials | null>(null);
	const [isInitializing, setIsInitializing] = useState(true);

	const activate = async (
		derived: DerivedIdentity,
		user: string,
		creds: RoomCredentials,
	) => {
		setActiveAccountId(derived.roomId);

		const storageKey = `texlyre-user-${derived.roomId}-settings`;
		const existing = JSON.parse(localStorage.getItem(storageKey) || '{}');
		const sig = getStoredSetting<string>('collabSignalingServers');
		const auto = getStoredSetting<boolean>('collabAutoReconnect');

		if (
			existing['collab-signaling-servers'] !== sig ||
			existing['collab-auto-reconnect'] !== auto
		) {
			localStorage.setItem(
				storageKey,
				JSON.stringify({
					...existing,
					'collab-signaling-servers': sig,
					'collab-auto-reconnect': auto,
				}),
			);
		}

		setIdentity(derived);
		setUsername(user);
		setCredentials(creds);
		window.dispatchEvent(new Event('chelys-account-changed'));
		await chelysAccountSyncService.start(
			derived.roomId,
			derived.roomKey,
			derived.roomId,
			user
		);
	};

	useEffect(() => {
		(async () => {
			try {
				const creds = await invoke<StoredCredentials | null>('load_credentials');
				console.log('restore: load_credentials ->', creds ? 'got creds' : 'null');
				if (creds) {
					const derived = await deriveIdentity({
						username: creds.username,
						password: creds.password,
						prfOutput: fromHex(creds.prf_output_hex),
					});
					await activate(derived, creds.username, {
						username: creds.username,
						password: creds.password,
						prfHex: creds.prf_output_hex,
					});
				}
			} catch (error) {
				console.error('Failed to load credentials:', error);
			} finally {
				setIsInitializing(false);
			}
		})();
	}, []);

	const login = async (user: string, password: string, prfHex: string) => {
		const normalizedPrf = prfHex.trim().toLowerCase();
		const derived = await deriveIdentity({
			username: user,
			password,
			prfOutput: fromHex(normalizedPrf),
		});
		await invoke('save_credentials', {
			username: user,
			password,
			prfOutputHex: normalizedPrf,
		});
		await activate(derived, user, {
			username: user,
			password,
			prfHex: normalizedPrf,
		});
	};

	const updateCredentials = async (next: RoomCredentials) => {
		chelysAccountSyncService.stop();
		await login(next.username, next.password, next.prfHex);
	};

	const logout = async () => {
		chelysAccountSyncService.stop();
		await invoke('clear_credentials');
		setIdentity(null);
		setUsername('');
		setCredentials(null);
		setActiveAccountId(null);
		window.dispatchEvent(new Event('chelys-account-changed'));
	};

	return (
		<RoomContext.Provider
			value={{
				identity,
				username,
				credentials,
				isInitializing,
				login,
				updateCredentials,
				logout,
			}}
		>
			{children}
		</RoomContext.Provider>
	);
};
