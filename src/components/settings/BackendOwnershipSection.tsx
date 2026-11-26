import { useCallback, useEffect, useId, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { t } from '@/i18n';
import SettingControl from './SettingControl';

type OwnerMode = 'automatic' | 'desktop' | 'headless';
type OwnerStatus = {
	preference: OwnerMode;
	active: 'desktop' | 'headless' | 'unavailable';
	restartRequired: boolean;
	issue?: string | null;
};

const descriptions: Record<OwnerMode, string> = {
	automatic: 'Attach to an existing backend, or start one that continues running after the desktop closes.',
	desktop: 'Only the desktop starts the backend; it stops when the desktop quits. The CLI can still connect while it is running.',
	headless: 'The daemon can start independently or when the desktop opens, and remains running after the desktop quits.',
};

// These controls are native profile settings, not account-backed settings.
export const runtimeSearchTerms = [
	'Backend ownership',
	'Preferred startup mode',
	'Automatic (recommended)',
	'Desktop-managed',
	'Headless daemon',
	'Start on system boot',
	'Start Chelys at OS login',
	'Install terminal command',
	'Restart backend',
	'Start backend',
	'Apply mode and restart backend',
];

export default function BackendOwnershipSection({
	compact = false,
}: {
	compact?: boolean;
}) {
	const controlId = useId();
	const [status, setStatus] = useState<OwnerStatus | null>(null);
	const [autostart, setAutostart] = useState<boolean | null>(null);
	const [cliPath, setCliPath] = useState<string | null>(null);
	const [busy, setBusy] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setStatus(await invoke<OwnerStatus>('instance_owner_get'));
		if (!compact) setAutostart(await isEnabled());
	}, [compact]);

	useEffect(() => {
		void refresh()
			.catch((caught) => setError(String(caught)))
			.finally(() => setBusy(false));
	}, [refresh]);

	const applyMode = async () => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await invoke('instance_restart');
			if (compact) {
				window.location.reload();
				return;
			}
			await refresh();
			setNotice(t('Backend is running.'));
		} catch (caught) {
			setError(String(caught));
		} finally {
			setBusy(false);
		}
	};

	const toggleAutostart = async (next: boolean) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			if (next) await enable();
			else await disable();
			setAutostart(await isEnabled());
		} catch (caught) {
			setError(String(caught));
		} finally {
			setBusy(false);
		}
	};

	const installCli = async () => {
		setBusy(true);
		setError(null);
		try {
			setCliPath(await invoke<string>('instance_install_cli'));
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
			setNotice(next.active === 'unavailable'
				? compact ? t('Preference saved. Retry the connection to start the backend.') : t('Preference saved. Start the backend to apply it.')
				: next.restartRequired
					? t('Preference saved. Apply the new mode to restart the backend.')
					: t('Preference saved.'));
		} catch (caught) {
			setError(String(caught));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className='settings-group backend-ownership' aria-label={t('Backend ownership')}>
			<div className='setting-control'>
				<div className='select-control ui-field' data-gap='xs'>
					<label htmlFor={controlId}>{t('Backend ownership')}</label>
					<select
						id={controlId}
						value={status?.preference ?? 'automatic'}
						disabled={busy || !status}
						onChange={(event) => void change(event.target.value as OwnerMode)}
					>
						<option value='automatic'>{t('Automatic (recommended)')}</option>
						<option value='desktop'>{t('Desktop-managed')}</option>
						<option value='headless'>{t('Headless daemon')}</option>
					</select>
				</div>
				<p className='setting-description ui-field-hint'>{t(descriptions[status?.preference ?? 'automatic'])}</p>
				<p className='setting-description'>
					{t('Backend:')} <strong>{!status ? t('Unknown') : status.active === 'unavailable' ? t('Not running') : status.active === 'desktop' ? t('Desktop-managed') : t('Headless')}</strong>
				</p>
				{status?.issue && <p className='error-message' role='alert'>{status.issue}</p>}
				{status?.restartRequired && (
					<p className='setting-description' role='status'>{t('The current backend uses a different startup mode.')}</p>
				)}
				{status && (!compact || status.restartRequired) && (
					<>
						<button type='button' className='secondary' disabled={busy} onClick={() => void applyMode()}>
							{status.restartRequired ? t('Apply mode and restart backend') : status.active === 'unavailable' ? t('Start backend') : t('Restart backend')}
						</button>
						{status.active !== 'unavailable' && <p className='setting-description'>{t('Restarting temporarily interrupts running recipes and remote connections.')}</p>}
					</>
				)}
			</div>
			{!compact && (
				<>
					<SettingControl
						setting={{
							id: 'runtime-autostart',
							category: t('System'),
							subcategory: t('Runtime'),
							type: 'checkbox',
							label: t('Start Chelys at OS login'),
							defaultValue: false,
							value: autostart === true,
							disabled: busy || autostart === null,
							disabledReason: autostart === null ? t('OS startup registration is unavailable or loading.') : undefined,
							description: !status
								? t('Starts Chelys according to the local backend ownership preference.')
								: status.preference === 'desktop'
									? t('Starts the desktop application, hidden in the system tray when available.')
									: t('Starts the backend without opening a desktop window.'),
						}}
						onLocalUpdate={(value) => void toggleAutostart(Boolean(value))}
					/>
					<div className='setting-control'>
						<button type='button' className='secondary' disabled={busy} onClick={() => void installCli()}>{t('Install terminal command')}</button>
						{cliPath && <p className='setting-description'>{t('Terminal command installed at {path}. Ensure the directory is in PATH.', { path: cliPath })}</p>}
					</div>
				</>
			)}
			{notice && <p className='setting-description' role='status'>{notice}</p>}
			{error && <p className='error-message' role='alert'>{error}</p>}
		</section>
	);
}
