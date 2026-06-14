import '@picocss/pico/css/pico.min.css';
import '@texlyre/styles/global.css';
import './styles/components/auth.css';
import './styles/components/project.css';
import './styles/components/settings.css';
import './styles/components/profile.css';
import './styles/components/collaborator-avatars.css';
import './styles/components/copy-field.css';
import './styles/components/plugin-host.css';
import './styles/themes/texlyre_wide/base.css';
import './styles/themes/texlyre_wide/layout.css';

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