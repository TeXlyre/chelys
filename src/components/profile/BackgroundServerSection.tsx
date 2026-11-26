// src/components/profile/BackgroundServerSection.tsx
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
					'Choose Automatic or Headless ownership before enabling daemon startup.',
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
				<h4>Background server</h4>
				<label className='checkbox-control'>
					<input
						type='checkbox'
						checked={enabled}
						disabled={busy || (owner === 'desktop' && !enabled)}
						onChange={(event) => void toggle(event.target.checked)}
					/>
					Start the headless daemon at OS login
				</label>
				<p className='setting-description'>
					Runs the bundled CLI with --headless; it does not launch a second
					desktop window. If Desktop ownership is selected, background daemon
					startup is disabled.
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
					Install terminal command
				</button>
				{cliPath && (
					<p className='setting-description'>
						Terminal command installed at {cliPath}. Ensure the directory is in
						PATH.
					</p>
				)}
				{error && (
					<p className='error-message' role='alert'>
						{error}
					</p>
				)}
			</section>
		</>
	);
}
