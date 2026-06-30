// src/components/app/SettingsDataApp.tsx
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import { useRoom } from '../../hooks/useRoom';
import { PluginHostProvider } from '../../contexts/PluginHostContext';
import RecipeList from '../plugin-host/RecipeList';
import ProfileModal from '../profile/ProfileModal';
import SettingsButton from '../settings/SettingsButton';
import UserDropdown from '../profile/UserDropdown';
import ThemeToggle from '../settings/ThemeToggle';
import {
	formatPlatform,
	getPlatformInfo,
	type PlatformInfo,
} from '../../plugin-host/platformResolution';
import { openExternalUrl } from '../../utils/platformUtils';
import AccountCollabIndicator from '../profile/AccountCollabIndicator';

function handleExternalLink(event: React.MouseEvent<HTMLAnchorElement>) {
	event.preventDefault();
	openExternalUrl(event.currentTarget.href);
}

const DashboardApp: React.FC = () => {
	const { username, logout } = useRoom();
	const [showProfile, setShowProfile] = useState(false);
	const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);

	useEffect(() => {
		let cancelled = false;

		const refreshPlatformInfo = () => {
			void getPlatformInfo()
				.then((info) => {
					if (!cancelled) setPlatformInfo(info);
				})
				.catch((error) => {
					console.warn('[Chelys] Failed to read platform info', error);
				});
		};

		refreshPlatformInfo();

		window.addEventListener('chelys-platform-changed', refreshPlatformInfo);

		return () => {
			cancelled = true;
			window.removeEventListener('chelys-platform-changed', refreshPlatformInfo);
		};
	}, []);

	return (
		<div className='app-container'>
			<header>
				<div className='header-left'>
					<img className='logo' alt='Chelys logo' src='/chelys-logo.svg'></img>
					<h1>{t('Chelys')}</h1>

				</div>
				<div className='header-right'>
					<AccountCollabIndicator />
					<SettingsButton className='auth-theme-toggle' />
					<UserDropdown
						username={username}
						onLogout={() => logout()}
						onOpenProfile={() => setShowProfile(true)}
					/>
					<ThemeToggle className='auth-theme-toggle' />
				</div>
			</header>

			<div className='main-content'>
				<div className='editor-container'>
					<div className='project-list-container'>
						{/* <div className='project-list-header'>
							<h3>{t('Plugins')}</h3>
						</div> */}
						<PluginHostProvider>
							<RecipeList />
						</PluginHostProvider>
					</div>
				</div>
			</div>

			<ProfileModal
				isOpen={showProfile}
				onClose={() => setShowProfile(false)}
			/>
			<footer>
				<p className='texlyre-info footer-platform'>
					{t('OS')}:{' '}
					{platformInfo
						? platformInfo.override === 'auto'
							? formatPlatform(platformInfo.detected)
							: `${formatPlatform(platformInfo.effective)} ${t('(manual)')}`
						: t('Detecting OS')}
				</p>

				<p className='texlyre-info'>
					<span className='footer-links'>
						<a href='https://texlyre.org' onClick={handleExternalLink}>
							{t('TeXlyre')}
						</a>{' '}
						•{' '}
						<a
							href='https://github.com/TeXlyre/chelys'
							onClick={handleExternalLink}
						>
							{t('Source Code')}
						</a>{' '}
						•{' '}
						<a
							href='https://github.com/TeXlyre/chelys/releases'
							onClick={handleExternalLink}
						>
							{t('Chelys Releases')}
						</a>{' '}
						{`v${__APP_VERSION__}`}
					</span>
				</p>
			</footer>
		</div>

	);
};

export default DashboardApp;