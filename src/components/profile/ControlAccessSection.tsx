// src/components/profile/ControlAccessSection.tsx
import { t } from '@/i18n';
import { useEffect, useState } from 'react';
import { localCommand } from '../../control/localClient';
import PeerControlSection from './PeerControlSection';
import InfrastructureSharingSection from './InfrastructureSharingSection';
import {
	PERMISSIONS,
	type AccessMode,
	type Permission,
} from '../../control/policy';

interface KeyInfo {
	id: string;
	name: string;
	permissions: Permission[];
	fields?: string[];
	createdAt: string;
}

export default function ControlAccessSection() {
	const [view, setView] = useState<'peers' | 'access'>('peers');
	const [keyFields, setKeyFields] = useState('');
	const [mode, setMode] = useState<AccessMode>('disabled');
	const [keys, setKeys] = useState<KeyInfo[]>([]);
	const [name, setName] = useState('');
	const [permissions, setPermissions] = useState<Permission[]>([
		'inventory.read',
		'recipes.read',
	]);
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const refresh = async () => {
		const result = (await localCommand('access.show')) as {
			mode: AccessMode;
			keys: KeyInfo[];
		};
		setMode(result.mode);
		setKeys(result.keys);
	};
	useEffect(() => {
		void refresh();
		const timer = setInterval(() => void refresh(), 5000);
		return () => clearInterval(timer);
	}, []);
	const perform = async (work: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await work();
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className='control-access ui-stack' data-gap='md'>
			<div
				className='view-tabs ui-tab-list control-subtabs'
				data-variant='switcher'
			>
				<button
					type='button'
					className={`tab-button ui-tab ${view === 'peers' ? 'active' : ''}`}
					onClick={() => setView('peers')}
				>
					{t('Peers')}
				</button>
				<button
					type='button'
					className={`tab-button ui-tab ${view === 'access' ? 'active' : ''}`}
					onClick={() => setView('access')}
				>
					{t('Access & keys')}
				</button>
			</div>
			{view === 'peers' ? (
				<PeerControlSection />
			) : (
				<>
					<h3>{t('Incoming remote access')}</h3>
					<p className='field-hint'>
						{t(
							'Recipe management is available to verified account peers. Remote edits to Chelys settings, TeXlyre data and the instance profile require API-key mode and explicit read/write permissions. Account login, credentials, access policies and peer endpoint configuration always remain local.',
						)}
					</p>
					<fieldset className='control-access-modes'>
						<legend>{t('Who can control this instance?')}</legend>
						{(
							[
								[
									'disabled',
									'No remote control',
									'Default: no remote control service is advertised.',
								],
								[
									'peers',
									'All connected peers',
									'Trusted account-room peers may manage ordinary recipes, which can execute local processes. Infrastructure changes and account data require explicit API keys.',
								],
								[
									'keys',
									'API key permissions',
									'A generated key is required and authorizes selected actions only. Share an invitation to connect across accounts.',
								],
							] as const
						).map(([value, label, detail]) => (
							<label key={value} className='control-access-mode'>
								<input
									type='radio'
									name='chelys-access-mode'
									checked={mode === value}
									disabled={busy}
									onChange={() =>
										void perform(async () => {
											await localCommand('access.mode', { mode: value });
										})
									}
								/>
								<span>
									<strong>{t(label)}</strong>
									<small>{t(detail)}</small>
								</span>
							</label>
						))}
					</fieldset>
					{error && (
						<p className='error-message' role='alert'>
							{t(error)}
						</p>
					)}
					{mode === 'keys' && (
						<>
							<h3>{t('Access keys')}</h3>
							<p className='field-hint'>
								{t(
									'Keys are displayed once. Keep them secure; revocation takes effect immediately. Invitations allow other accounts to find this instance through WebRTC, but do not grant access without the matching key. Share the key separately.',
								)}
							</p>
							{keys.map((key) => (
								<div key={key.id} className='control-access-key'>
									<div>
										<strong>{key.name}</strong>
										<small>
											{key.permissions
												.map((permission) => t(permission))
												.join(', ')}
											{key.fields?.length
												? ` · ${t('Fields: {fields}', { fields: key.fields.join(', ') })}`
												: ''}
										</small>
									</div>
									<div className='control-toolbar'>
										{confirmRevoke === key.id ? (
											<>
												<button
													type='button'
													className='button secondary'
													onClick={() => setConfirmRevoke(null)}
												>
													{t('Cancel')}
												</button>
												<button
													type='button'
													className='button primary'
													disabled={busy}
													onClick={() =>
														void perform(async () => {
															await localCommand('access.keys.revoke', {
																id: key.id,
															});
															setConfirmRevoke(null);
														})
													}
												>
													{t('Confirm revoke')}
												</button>
											</>
										) : (
											<>
												<button
													type='button'
													className='button secondary'
													disabled={busy}
													onClick={() =>
														void perform(async () => {
															const result = await localCommand<{
																invitation: string;
															}>('access.keys.invitation', { id: key.id });
															await navigator.clipboard.writeText(
																result.invitation,
															);
														})
													}
												>
													{t('Copy invitation')}
												</button>
												<button
													type='button'
													className='button secondary'
													disabled={busy}
													onClick={() => setConfirmRevoke(key.id)}
												>
													{t('Revoke')}
												</button>
											</>
										)}
									</div>
								</div>
							))}
							<div className='form-group ui-field'>
								<label htmlFor='chelys-control-key-name'>{t('Key name')}</label>
								<input
									id='chelys-control-key-name'
									value={name}
									disabled={busy}
									onChange={(event) => setName(event.target.value)}
									placeholder={t('Automation')}
								/>
							</div>
							<fieldset className='control-access-permissions'>
								<legend>{t('Permissions')}</legend>
								{PERMISSIONS.map((permission) => (
									<label key={permission}>
										<input
											type='checkbox'
											checked={permissions.includes(permission)}
											disabled={busy}
											onChange={(event) =>
												setPermissions((current) =>
													event.target.checked
														? [...current, permission]
														: current.filter((item) => item !== permission),
												)
											}
										/>
										{t(permission)}
									</label>
								))}
							</fieldset>
							{permissions.includes('recipes.telemetry.read') && (
								<div className='form-group ui-field'>
									<label htmlFor='chelys-key-fields'>
										{t('Restrict telemetry categories (optional)')}
									</label>
									<input
										id='chelys-key-fields'
										value={keyFields}
										disabled={busy}
										placeholder={t(
											'cpu,memory (blank = all categories shared by this instance)',
										)}
										onChange={(event) => setKeyFields(event.target.value)}
									/>
									<small className='field-hint'>
										{t(
											"This restriction is additional to the recipe's sharing policy.",
										)}
									</small>
								</div>
							)}
							<div className='modal-actions'>
								<button
									type='button'
									className='button primary'
									disabled={busy || !name.trim() || !permissions.length}
									onClick={() =>
										void perform(async () => {
											const created = (await localCommand(
												'access.keys.create',
												{
													name,
													permissions,
													...(permissions.includes('recipes.telemetry.read') &&
													keyFields.trim()
														? {
																fields: keyFields
																	.split(',')
																	.map((field) => field.trim())
																	.filter(Boolean),
															}
														: {}),
												},
											)) as { key: string };
											setCreatedKey(created.key);
											setName('');
											setKeyFields('');
										})
									}
								>
									{t('Generate key')}
								</button>
							</div>
							{createdKey && (
								<div className='warning-message'>
									<p>
										{t('Copy this key now. It will not be displayed again.')}
									</p>
									<code className='control-access-generated'>{createdKey}</code>
									<button
										type='button'
										className='button secondary'
										onClick={() =>
											void navigator.clipboard.writeText(createdKey)
										}
									>
										{t('Copy key')}
									</button>
									<button
										type='button'
										className='button secondary'
										onClick={() => setCreatedKey(null)}
									>
										{t('Dismiss')}
									</button>
								</div>
							)}
						</>
					)}
					<InfrastructureSharingSection />
				</>
			)}
		</section>
	);
}
