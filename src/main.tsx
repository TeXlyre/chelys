// src/main.tsx
import './webrtc-polyfill/install';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { installWebRtcPolyfill } from './webrtc-polyfill';
import { applyThemeVariant, getInitialVariant } from './theme/themeVariant';
import { App } from './App';

const keepBackgroundRuntimeAlive = (): void => {
	if (!('locks' in navigator)) return;

	void navigator.locks
		.request('chelys-background-runtime', async () => {
			await new Promise<void>(() => {
				// Keep the lock for the lifetime of this webview.
			});
		})
		.catch((error: unknown) => {
			console.warn('[Chelys] Failed to acquire background runtime lock', error);
		});
};

await installWebRtcPolyfill();
keepBackgroundRuntimeAlive();

document.documentElement.setAttribute('data-layout', 'texlyre-wide');
document.documentElement.setAttribute('data-theme-plugin', 'texlyre');
applyThemeVariant(getInitialVariant());

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
