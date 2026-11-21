// src/contexts/RoomContext.tsx
import type React from 'react';
import {
	type ReactNode,
	createContext,
	useEffect,
	useRef,
	useState,
} from 'react';
import { localCommand } from '../control/localClient';
import { flushSharedStorage } from '../runtime/storageMirror';
import { setActiveAccountId } from '../plugin-host/activeAccount';
import type { RoomDefaults } from '../config';

interface RoomCredentials {
	username: string;
	password: string;
	prfHex: string;
}
interface CredentialStorageStatus {
	backend: 'keyring' | 'file';
	warning: string | null;
	migrated: boolean;
}
interface AccountStatus {
	loggedIn: boolean;
	accountId?: string | null;
	username?: string | null;
	credentialStorage?: CredentialStorageStatus | null;
}
interface RoomContextType {
	identity: { roomId: string } | null;
	username: string;
	credentials: RoomCredentials | null;
	isInitializing: boolean;
	credentialWarning: string | null;
	login: (username: string, password: string, prfHex: string) => Promise<void>;
	updateCredentials: (next: RoomCredentials) => Promise<void>;
	logout: () => Promise<void>;
}

export const RoomContext = createContext<RoomContextType>({
	identity: null,
	username: '',
	credentials: null,
	isInitializing: true,
	credentialWarning: null,
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
	const [identity, setIdentity] = useState<{ roomId: string } | null>(null);
	const [username, setUsername] = useState('');
	const [credentials, setCredentials] = useState<RoomCredentials | null>(null);
	const [isInitializing, setIsInitializing] = useState(true);
	const [credentialWarning, setCredentialWarning] = useState<string | null>(
		null,
	);
	const lastAccount = useRef<string | null>(null);

	const applyStatus = (status: AccountStatus) => {
		const roomId = status.loggedIn ? (status.accountId ?? null) : null;
		lastAccount.current = roomId;
		setIdentity(roomId ? { roomId } : null);
		setUsername(status.loggedIn ? (status.username ?? '') : '');
		setActiveAccountId(roomId);
		setCredentialWarning(status.credentialStorage?.warning ?? null);
		if (!status.loggedIn) setCredentials(null);

		window.dispatchEvent(new Event('chelys-account-changed'));
	};

	const loadPrivateProfile = async (status: AccountStatus) => {
		try {
			const stored = await localCommand<{
				username: string;
				prf_output_hex: string;
			} | null>('account.credentials');
			if (stored && stored.username === status.username) {
				setCredentials({
					username: stored.username,
					password: '',
					prfHex: stored.prf_output_hex,
				});
			} else setCredentials(null);
		} catch {
			setCredentials(null); // Authentication still works when profile secrets cannot be displayed.
		}
	};

	useEffect(() => {
		let alive = true;
		const refreshAccount = async () => {
			try {
				const status = await localCommand<AccountStatus>('account.status');
				if (!alive) return;
				setCredentialWarning(status.credentialStorage?.warning ?? null);
				const nextRoom = status.loggedIn ? (status.accountId ?? null) : null;
				if (nextRoom !== lastAccount.current) {
					applyStatus(status);
					if (status.loggedIn) await loadPrivateProfile(status);
				}
			} catch (error) {
				if (alive)
					setCredentialWarning(`Cannot connect to Chelys: ${String(error)}`);
			} finally {
				if (alive) setIsInitializing(false);
			}
		};
		void refreshAccount();
		const timer = setInterval(() => {
			void refreshAccount();
		}, 3000);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, []);

	const login = async (user: string, password: string, prfHex: string) => {
		const normalized = prfHex.trim().toLowerCase();
		if (!/^(?:[0-9a-f]{2})+$/.test(normalized))
			throw new Error('Valid hexadecimal Chelys key required');
		await flushSharedStorage();
		const status = await localCommand<AccountStatus>('account.login', {
			username: user,
			password,
			prf_output_hex: normalized,
		});
		applyStatus(status);
		setCredentials({ username: user, password: '', prfHex: normalized });
	};

	const updateCredentials = async (next: RoomCredentials) => {
		await flushSharedStorage();
		const status = await localCommand<AccountStatus>('profile.update', {
			username: next.username,
			...(next.password ? { password: next.password } : {}),
			prf_output_hex: next.prfHex,
		});
		applyStatus(status);
		setCredentials({ ...next, password: '' });
	};

	const logout = async () => {
		const status = await localCommand<AccountStatus>('account.logout');
		applyStatus(status);
	};

	return (
		<RoomContext.Provider
			value={{
				identity,
				username,
				credentials,
				isInitializing,
				credentialWarning,
				login,
				updateCredentials,
				logout,
			}}
		>
			{children}
		</RoomContext.Provider>
	);
};
