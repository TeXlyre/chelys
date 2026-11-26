// src/main.tsx
import '@picocss/pico/css/pico.min.css';
import '@texlyre/styles/global.css';
import '../external/texlyre/extras/themes/texlyre_wide/styles/index.css';
import './styles/components/auth.css';
import './styles/components/project.css';
import './styles/components/settings.css';
import './styles/components/profile.css';
import './styles/components/plugin-host.css';
import '@texlyre/styles/components/collaborator-avatars.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { applyThemeVariant, getInitialVariant } from './theme/themeVariant';

const target = document.getElementById('root');
if (!target) throw new Error('Chelys root element not found');
document.documentElement.setAttribute('data-layout', 'texlyre-wide');
document.documentElement.setAttribute('data-theme-plugin', 'texlyre');
applyThemeVariant(getInitialVariant());
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
	if (getInitialVariant() === 'system') applyThemeVariant('system');
});
const root = createRoot(target);
const showRecovery = async (reason?: string) => {
	const { default: BackendRecovery } = await import('./components/profile/BackendRecovery');
	root.render(<StrictMode><BackendRecovery reason={reason} /></StrictMode>);
};
try {
	const mode = await invoke<'attached' | 'unavailable'>('instance_mode');
	if (mode === 'unavailable') {
		await showRecovery();
	} else {
		const { initializeSharedStorage } = await import('./runtime/storageMirror');
		await initializeSharedStorage();
		applyThemeVariant(getInitialVariant());
		const { App } = await import('./App');
		root.render(<StrictMode><App /></StrictMode>);
	}
} catch (error) {
	await showRecovery(String(error));
}
