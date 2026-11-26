// src/components/profile/BackgroundServerSection.tsx
import { t } from '@/i18n';
import { useEffect, useState } from 'react';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { invoke } from '@tauri-apps/api/core';
import ProfileOwnershipSection from './ProfileOwnershipSection';

export default function BackgroundServerSection() {
	const [enabled, setEnabled] = useState(false);
	const [busy, setBusy] = useState(true);
	const [cliPath, setCliPath] = useState<string | null>(null);
	const [owner, setOwner] = useState<'automatic' | 'desktop' | 'headless'>(
		'automatic',
	);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		void invoke<{ preference: 'automatic' | 'desktop' | 'headless' }>(
			'instance_owner_get',
		)
			.then((value) => setOwner(value.preference))
			.catch((caught) => setError(String(caught)));
		void isEnabled()
			.then(setEnabled)
			.catch((caught) => setError(String(caught)))
			.finally(() => setBusy(false));
	}, []);
	const toggle = async (next: boolean) => {
		setBusy(true);
		setError(null);
		try {
			const current = await invoke<{
				preference: 'automatic' | 'desktop' | 'headless';
			}>('instance_owner_get');
			setOwner(current.preference);
			if (next && current.preference === 'desktop')
				throw new Error(
					t(
						'Choose Automatic or Headless ownership before enabling daemon startup.',
					),
				);
			if (next) await enable();
			else await disable();
			setEnabled(next);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	};
	return (
		<>
			<ProfileOwnershipSection
				onChange={(mode) => {
					setOwner(mode);
					void isEnabled()
						.then(setEnabled)
						.catch((caught) => setError(String(caught)));
				}}
			/>
			<section className='settings-group'>
				<h4>{t('Background server')}</h4>
				<label className='checkbox-control'>
					<input
						type='checkbox'
						checked={enabled}
						disabled={busy || (owner === 'desktop' && !enabled)}
						onChange={(event) => void toggle(event.target.checked)}
					/>
					{t('Start the headless daemon at OS login')}
				</label>
				<p className='setting-description'>
					{t(
						'Start the bundled CLI in headless mode without opening another window. Available with Automatic or Headless ownership.',
					)}
				</p>
				<button
					type='button'
					className='secondary'
					onClick={() =>
						void invoke<string>('instance_install_cli')
							.then(setCliPath)
							.catch((caught) => setError(String(caught)))
					}
				>
					{t('Install terminal command')}
				</button>
				{cliPath && (
					<p className='setting-description'>
						{t(
							'Terminal command installed at {path}. Ensure the directory is in PATH.',
							{ path: cliPath },
						)}
					</p>
				)}
				{error && (
					<p className='error-message' role='alert'>
						{t(error)}
					</p>
				)}
			</section>
		</>
	);
}
