// src/App.tsx

import { ROOM_DEFAULTS } from './config';
import { RoomProvider } from './contexts/RoomContext';
import { SettingsProvider } from './contexts/SettingsContext';
import AppRouter from './components/app/AppRouter';

export function App() {
	return (
		<SettingsProvider>
			<RoomProvider defaults={ROOM_DEFAULTS}>
				<AppRouter />
			</RoomProvider>
		</SettingsProvider>
	);
}
