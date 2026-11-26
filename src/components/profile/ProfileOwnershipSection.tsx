// src/components/profile/ProfileOwnershipSection.tsx
import { t } from '@/i18n';
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { disable, isEnabled } from '@tauri-apps/plugin-autostart';

type OwnerMode = 'automatic' | 'desktop' | 'headless';
type OwnerStatus = {
	preference: OwnerMode;
	active: 'desktop' | 'headless' | 'unavailable';
	restartRequired: boolean;
	issue?: string | null;
};

const descriptions: Record<OwnerMode, string> = {
	automatic:
		'Attach to an existing backend, or start one that continues running after the desktop closes.',
	desktop:
		'Start and stop the backend with the desktop. The CLI can connect while the backend is running.',
	headless:
		'Allow the daemon to start independently and remain running without the desktop.',
};

export default function ProfileOwnershipSection({
	compact = false,
	onChange,
}: {
	compact?: boolean;
	onChange?: (mode: OwnerMode) => void;
}) {
	const [status, setStatus] = useState<OwnerStatus | null>(null);
	const [busy, setBusy] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const refresh = useCallback(async () => {
		try {
			setStatus(await invoke<OwnerStatus>('instance_owner_get'));
			setError(null);
		} catch (caught) {
			setError(String(caught));
		} finally {
			setBusy(false);
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	const applyMode = async () => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await invoke('instance_restart');
			await refresh();
			setNotice(t('Backend restarted with the selected mode.'));
		} catch (caught) {
			setError(String(caught));
		} finally {
			setBusy(false);
		}
	};
	const change = async (mode: OwnerMode) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const next = await invoke<OwnerStatus>('instance_owner_set', { mode });
			setStatus(next);
			if (mode === 'desktop') {
				try {
					if (await isEnabled()) await disable();
				} catch (caught) {
					setError(
						t(
							'Preference saved, but OS autostart could not be disabled: {error}',
							{ error: String(caught) },
						),
					);
				}
			}
			onChange?.(mode);
			setNotice(
				next.active === 'unavailable'
					? t('Preference saved. Retry the connection to start the backend.')
					: next.restartRequired
						? t('Preference saved. Apply the new mode to restart the backend.')
						: t('Preference saved.'),
			);
		} catch (caught) {
			setError(String(caught));
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className='settings-group profile-ownership'>
			<h4>{t('Profile runtime owner')}</h4>
			<label htmlFor='profile-runtime-owner'>
				{t('Preferred startup mode')}
			</label>
			<select
				id='profile-runtime-owner'
				value={status?.preference ?? 'automatic'}
				disabled={busy || !status}
				onChange={(event) => void change(event.target.value as OwnerMode)}
			>
				<option value='automatic'>{t('Automatic (recommended)')}</option>
				<option value='desktop'>{t('Desktop-managed')}</option>
				<option value='headless'>{t('Headless daemon')}</option>
			</select>
			<p className='setting-description'>
				{t(descriptions[status?.preference ?? 'automatic'])}
			</p>
			<p className='setting-description'>
				{t('Backend:')}{' '}
				<strong>
					{status?.active === 'unavailable' || !status
						? t('Not running')
						: status.active === 'desktop'
							? t('Desktop-managed')
							: t('Headless')}
				</strong>
			</p>
			{!compact && (
				<p className='setting-description'>
					{t(
						'All modes share one backend, with the same recipes, CLI and remote connections.',
					)}
				</p>
			)}
			{status?.issue && (
				<p className='error-message' role='alert'>
					{t(status.issue)}
				</p>
			)}
			{status?.restartRequired && (
				<p className='setting-description' role='status'>
					{t('The current backend uses a different startup mode.')}
				</p>
			)}
			{!compact && status?.restartRequired && (
				<button
					type='button'
					className='secondary'
					disabled={busy}
					onClick={() => void applyMode()}
				>
					{t('Apply mode and restart backend')}
				</button>
			)}
			{notice && (
				<p className='setting-description' role='status'>
					{notice}
				</p>
			)}
			{error && (
				<p className='error-message' role='alert'>
					{t(error)}
				</p>
			)}
		</section>
	);
}
