// src/components/profile/PeerControlSection.tsx
import { useEffect, useState } from 'react';
import { localCommand } from '../../control/localClient';

interface Peer {
	id?: string;
	alias?: string;
	username?: string;
	transport: string;
	controlAvailable?: boolean;
}
interface Recipe {
	id: string;
	name: string;
	type: string;
	state: string;
	mode: string | null;
	modes: string[];
	inspectable?: boolean;
    groupActive?: boolean;
	inspectionFields?: Array<{ id: string; label: string; sensitivity: string }>;
}
interface Inventory {
	instanceId: string;
	name: string;
	machine?: {
		platform?: string;
		architecture?: string;
		freeStorageBytes?: string;
		hostname?: string;
		memoryBytes?: string;
	} | null;
	availableRecipes: Recipe[];
	runningRecipes?: Recipe[];
	canInstallRecipes: boolean;
	canRunRecipes: boolean;
	canManageInfrastructure?: boolean;
}
interface MetricResult {
	id: string;
	state: string;
	sampledAt: string | null;
	scope: string | null;
	metrics: Record<string, unknown> | null;
	fields: Array<{ id: string; label: string }>;
}
const humanLabel = (value: string) =>
	value
		.replace(/([A-Z])/g, ' $1')
		.replace(/([_-])/g, ' ')
		.replace(/^./, (c) => c.toUpperCase());
const metricRows = (value: unknown): Array<[string, unknown]> => {
	if (Array.isArray(value)) {
		return value.flatMap(
			(item, index): Array<[string, unknown]> =>
				item && typeof item === 'object' && !Array.isArray(item)
					? Object.entries(item).map(([key, entry]) => [
							`#${index + 1} · ${key}`,
							entry,
						])
					: [[`#${index + 1}`, item]],
		);
	}
	return value && typeof value === 'object' ? Object.entries(value) : [];
};
const readable = (name: string, value: unknown): string => {
	if (value === null || value === undefined) return 'Unavailable';
	if (
		typeof value === 'number' ||
		(typeof value === 'string' && /^\d+$/.test(value))
	) {
		const n = Number(value);
		if (Number.isFinite(n)) {
			if (/BytesPerSecond$/i.test(name))
				return `${(n / 1024 ** 2).toFixed(2)} MiB/s`;
			if (/Bytes$/i.test(name)) return `${(n / 1024 ** 3).toFixed(2)} GiB`;
			if (/Percent$/i.test(name)) return `${n.toFixed(1)}%`;
			if (/Watts$/i.test(name)) return `${n.toFixed(1)} W`;
			if (/Joules$/i.test(name)) return `${n.toFixed(2)} J`;
			if (/Celsius$|TemperatureC$/i.test(name)) return `${n.toFixed(1)} °C`;
			if (/MiB$/i.test(name)) return `${n.toFixed(1)} MiB`;
		}
	}
	return typeof value === 'object' ? JSON.stringify(value) : String(value);
};
const freeSpace = (value?: string) =>
	value && /^\d+$/.test(value)
		? `${(Number(value) / 1024 ** 3).toFixed(1)} GiB free`
		: null;

export default function PeerControlSection() {
	const [peers, setPeers] = useState<Peer[]>([]);
	const [target, setTarget] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [alias, setAlias] = useState('');
	const [url, setUrl] = useState('');
	const [connectionTransport, setConnectionTransport] = useState<'webrtc' | 'websocket'>('webrtc');
	const [connectionKey, setConnectionKey] = useState('');
	const [adding, setAdding] = useState(false);
	const [inventory, setInventory] = useState<Inventory | null>(null);
	const [tab, setTab] = useState<'overview' | 'metrics' | 'recipes'>(
		'overview',
	);
	const [metrics, setMetrics] = useState<MetricResult | null>(null);
	const [monitorId, setMonitorId] = useState('');
	const [selectedFields, setSelectedFields] = useState<string[]>([]);
	const [modeByRecipe, setModeByRecipe] = useState<Record<string, string>>({});
	const [pending, setPending] = useState(false);
	const [error, setError] = useState('');
	const [confirmRemoval, setConfirmRemoval] = useState('');
	const refreshPeers = async () =>
		setPeers((await localCommand('peers.list')) as Peer[]);
	useEffect(() => {
		void refreshPeers().catch((caught) => setError(String(caught)));
	}, []);
	const perform = async (work: () => Promise<void>) => {
		setPending(true);
		setError('');
		try {
			await work();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setPending(false);
		}
	};
	const remote = (method: string, params: Record<string, unknown> = {}) =>
		localCommand('peers.call', {
			target,
			apiKey: apiKey || undefined,
			method,
			params,
		});
	const inspect = async () => {
		const result = (await remote('instance.inspect')) as Inventory;
		setInventory(result);
		setMonitorId((previous) =>
			result.availableRecipes.some(
				(recipe) => recipe.id === previous && recipe.inspectable,
			)
				? previous
				: result.availableRecipes.find((recipe) => recipe.inspectable)?.id ||
					'',
		);
		setMetrics(null);
		setSelectedFields([]);
	};
	const selectPeer = (value: string) => {
		setTarget(value);
		setInventory(null);
		setMetrics(null);
		setApiKey('');
		setError('');
		setConfirmRemoval('');
		setTab('overview');
	};
	const selectedPeer = peers.find(
		(peer) => (peer.id ?? peer.alias ?? peer.username) === target,
	);
	const selectedAlias = selectedPeer?.alias;
	const inspectionRecipes =
		inventory?.availableRecipes.filter((recipe) => recipe.inspectable) || [];
	const currentInspectionRecipe = inspectionRecipes.find(
		(recipe) => recipe.id === monitorId,
	);

	return (
		<section className='control-peer-section'>
			<div className='control-panel-heading'>
				<div>
					<h3>Remote instances</h3>
					<p className='field-hint'>
						Discover account peers or connect to another instance using an invitation or WebSocket endpoint.
					</p>
				</div>
				<div className='control-toolbar'>
					<button
						type='button'
						className='button secondary'
						disabled={pending}
						onClick={() => void perform(refreshPeers)}
					>
						Refresh
					</button>
					<button
						type='button'
						className='button primary'
						aria-expanded={adding}
						onClick={() => {
							setAdding((previous) => !previous);
							setConnectionKey('');
						}}
					>
						{adding ? 'Cancel' : 'Add connection'}
					</button>
				</div>
			</div>
			{adding && (
				<form
					className='control-peer-connect'
					onSubmit={(event) => {
						event.preventDefault();
						void perform(async () => {
							await localCommand('peers.connect', { alias, url: url.trim(), apiKey: connectionKey || undefined });
							selectPeer(alias);
							setApiKey(connectionKey);
							setConnectionKey('');
							setAlias('');
							setUrl('');
							setAdding(false);
							await refreshPeers();
						});
					}}
				>
					<input
						aria-label='Connection alias'
						placeholder='Connection alias'
						value={alias}
						required
						onChange={(e) => setAlias(e.target.value)}
					/>
					<select aria-label='Connection transport' value={connectionTransport} onChange={event => {
						setConnectionTransport(event.target.value as 'webrtc' | 'websocket');
						setUrl('');
					}}>
						<option value='webrtc'>WebRTC invitation</option>
						<option value='websocket'>WebSocket endpoint</option>
					</select>
					<input
						aria-label={connectionTransport === 'webrtc' ? 'Connection invitation' : 'WebSocket endpoint'}
						placeholder={connectionTransport === 'webrtc' ? 'Paste Chelys invitation' : 'wss://host/control'}
						value={url}
						required
						onChange={(e) => setUrl(e.target.value)}
					/>
					<input type='password' autoComplete='off' aria-label='Remote API key' placeholder='API key (not saved)' value={connectionKey} onChange={event => setConnectionKey(event.target.value)} required={connectionTransport === 'webrtc'} />
					<button type='submit' className='button primary' disabled={pending || (connectionTransport === 'webrtc' ? !url.startsWith('chelys-webrtc:') : !/^wss?:\/\//.test(url))}>
						Save
					</button>
				</form>
			)}
			<div className='control-peer-layout' data-empty={peers.length === 0 && !target}>
				<section
					className='control-peer-list'
					aria-label='Discovered and saved Chelys peers'
				>
					{peers.length === 0 && (
						<p className='control-empty-state ui-empty-state' data-style='empty'>
							No remote instances discovered or saved.
						</p>
					)}
					{peers.map((peer) => {
						const value = peer.id ?? peer.alias ?? peer.username;
						if (!value) return null;
						return (
							<button
								type='button'
								key={value}
								className={`control-peer-item ${target === value ? 'selected' : ''}`}
								onClick={() => selectPeer(value)}
								aria-pressed={target === value}
							>
								<strong>{peer.alias || peer.username || value}</strong>
								<small>
									{peer.transport === 'websocket'
										? 'Saved endpoint'
										: peer.alias ? 'Saved WebRTC invitation' : peer.controlAvailable === false
											? 'Present · control disabled'
											: 'Discovered via WebRTC'}
								</small>
							</button>
						);
					})}
				</section>
				<div className='control-peer-detail' hidden={peers.length === 0 && !target}>
					{!target ? (
						<p className='control-empty-state field-hint'>
							Select an instance to inspect the information and recipes it
							allows you to see.
						</p>
					) : (
						<>
							<div className='control-panel-heading'>
								<div>
									<h3>
										{inventory?.name ||
											selectedPeer?.alias ||
											selectedPeer?.username ||
											target}
									</h3>
									<small className='field-hint'>
										{inventory
											? 'Inspected successfully'
											: 'Access not yet verified'}{' '}
										· {selectedPeer?.transport}
									</small>
								</div>
								<div className='control-toolbar'>
									<button
										type='button'
										className='button secondary'
										disabled={
											pending || selectedPeer?.controlAvailable === false || (!!selectedPeer?.alias && !apiKey.trim())
										}
										onClick={() => void perform(inspect)}
									>
										Inspect
									</button>
									{selectedAlias && (
										<button
											type='button'
											className='button secondary'
											disabled={pending}
											onClick={() => setConfirmRemoval(selectedAlias)}
										>
											Remove
										</button>
									)}
								</div>
							</div>
							{selectedPeer?.alias && confirmRemoval === selectedPeer.alias && (
								<div className='warning-message' role='alert'>
									<p>
										Remove the saved connection “{selectedPeer.alias}”?
										This does not revoke its API keys on the remote machine.
									</p>
									<div className='control-toolbar'>
										<button
											type='button'
											className='button secondary'
											onClick={() => setConfirmRemoval('')}
										>
											Cancel
										</button>
										<button
											type='button'
											className='button primary'
											disabled={pending}
											onClick={() =>
												void perform(async () => {
													await localCommand('peers.disconnect', {
														alias: selectedPeer.alias,
													});
													selectPeer('');
													await refreshPeers();
												})
											}
										>
											Remove connection
										</button>
									</div>
								</div>
							)}
							<div className='form-group ui-field'>
								<label htmlFor='chelys-peer-key'>
									API key for this peer {selectedPeer?.alias ? '(required)' : '(if required)'}
								</label>
								<input
									id='chelys-peer-key'
									type='password'
									value={apiKey}
									autoComplete='off'
									placeholder='Enter if required by the remote instance'
									onChange={(event) => setApiKey(event.target.value)}
								/>
							</div>
							{inventory && (
								<>
									<div
										className='view-tabs ui-tab-list control-subtabs'
										data-variant='switcher'
									>
										{(['overview', 'metrics', 'recipes'] as const).map(
											(value) => (
												<button
													type='button'
													key={value}
													className={`tab-button ui-tab ${tab === value ? 'active' : ''}`}
													onClick={() => setTab(value)}
												>
													{humanLabel(value)}
												</button>
											),
										)}
									</div>
									{tab === 'overview' && (
										<dl className='control-peer-facts'>
											<dt>Instance</dt>
											<dd>{inventory.instanceId}</dd>
											<dt>Machine</dt>
											<dd>
												{inventory.machine?.platform || 'Restricted'}{' '}
												{inventory.machine?.architecture || ''}
											</dd>
											<dt>Storage</dt>
											<dd>
												{freeSpace(inventory.machine?.freeStorageBytes) ||
													'Restricted or unavailable'}
											</dd>
											<dt>Running recipes</dt>
											<dd>
												{inventory.runningRecipes?.length ??
													inventory.availableRecipes.filter(
														(recipe) => recipe.state === 'running',
													).length}
											</dd>
											<dt>Recipe installation</dt>
											<dd>
												{inventory.canInstallRecipes
													? 'Permitted'
													: 'Restricted'}
											</dd>
											<dt>Recipe execution</dt>
											<dd>
												{inventory.canRunRecipes ? 'Permitted' : 'Restricted'}
											</dd>
											<dt>Infrastructure management</dt>
											<dd>
												{inventory.canManageInfrastructure
													? 'Permitted'
													: 'Restricted'}
											</dd>
										</dl>
									)}
									{tab === 'metrics' && (
										<section className='control-monitor-details'>
											{inspectionRecipes.length === 0 ? (
												<p className='field-hint'>
													This peer has no inspectable recipes.
												</p>
											) : (
												<>
													<div className='control-peer-connect'>
														<select
															aria-label='Inspectable recipe'
															value={monitorId}
															onChange={(event) => {
																setMonitorId(event.target.value);
																setMetrics(null);
																setSelectedFields([]);
															}}
														>
															{inspectionRecipes.map((recipe) => (
																<option key={recipe.id} value={recipe.id}>
																	{recipe.name}
																</option>
															))}
														</select>
														<button
															type='button'
															className='button secondary'
															disabled={pending || !monitorId}
															onClick={() =>
																void perform(async () =>
																	setMetrics(
																		(await remote('recipes.metrics', {
																			id: monitorId,
																			...(selectedFields.length
																				? { fields: selectedFields }
																				: {}),
																		})) as MetricResult,
																	),
																)
															}
														>
															Read metrics
														</button>
													</div>
													{currentInspectionRecipe?.inspectionFields?.length ? (
														<fieldset className='control-access-permissions control-peer-field-selector'>
															<legend>
																Request only selected categories (none selected
																= all permitted)
															</legend>
															{currentInspectionRecipe.inspectionFields?.map(
																(field) => (
																	<label key={field.id}>
																		<input
																			type='checkbox'
																			checked={selectedFields.includes(
																				field.id,
																			)}
																			onChange={(event) =>
																				setSelectedFields((current) =>
																					event.target.checked
																						? [...current, field.id]
																						: current.filter(
																								(id) => id !== field.id,
																							),
																				)
																			}
																		/>
																		{field.label}
																	</label>
																),
															)}
														</fieldset>
													) : null}
													{metrics && (
														<>
															<p className='field-hint'>
																Scope: {metrics.scope || 'Unavailable'} ·
																Sampled:{' '}
																{metrics.sampledAt || 'No recent sample'} ·{' '}
																{metrics.state}
															</p>
															<div className='control-metric-grid'>
																{metrics.fields.map((field) => (
																	<div
																		className='control-metric'
																		key={field.id}
																	>
																		<strong>{field.label}</strong>
																		{metrics.metrics?.[field.id] &&
																		typeof metrics.metrics[field.id] ===
																			'object' ? (
																			<dl>
																				{metricRows(
																					metrics.metrics[field.id],
																				).map(([name, value]) => (
																					<div key={name}>
																						<dt>{humanLabel(name)}</dt>
																						<dd>{readable(name, value)}</dd>
																					</div>
																				))}
																			</dl>
																		) : (
																			<small>
																				{readable(
																					field.id,
																					metrics.metrics?.[field.id],
																				)}
																			</small>
																		)}
																	</div>
																))}
															</div>
														</>
													)}
												</>
											)}
										</section>
									)}
									{tab === 'recipes' && (
										<div className='control-peer-inventory'>
											{inventory.availableRecipes.length === 0 && (
												<p className='field-hint'>No recipes advertised.</p>
											)}
											{inventory.availableRecipes.map((recipe) => (
												<div className='control-peer-recipe' key={recipe.id}>
													<div>
														<strong>{recipe.name}</strong>
														<small>
															{recipe.type} · {recipe.state}
														</small>
													</div>
													<div className='control-peer-recipe-actions'>
														{recipe.state === 'running' || recipe.groupActive ? (
															<button
																type='button'
																className='button secondary'
																disabled={
																	!inventory.canRunRecipes ||
																	(recipe.type === 'infrastructure' &&
																		!inventory.canManageInfrastructure) ||
																	pending
																}
																onClick={() =>
																	void perform(async () => {
																		await remote('recipes.stop', {
																			id: recipe.id,
																		});
																		await inspect();
																	})
																}
															>
																Stop
															</button>
														) : (
															<button
																type='button'
																className='button secondary'
																disabled={
																	!inventory.canRunRecipes ||
																	(recipe.type === 'infrastructure' &&
																		!inventory.canManageInfrastructure) ||
																	pending ||
																	!recipe.mode
																}
																onClick={() =>
																	void perform(async () => {
																		await remote('recipes.run', {
																			id: recipe.id,
																		});
																		await inspect();
																	})
																}
															>
																Run
															</button>
														)}
														<select
															aria-label={`Install mode for ${recipe.name}`}
															value={
																modeByRecipe[recipe.id] ?? recipe.modes[0] ?? ''
															}
															onChange={(event) =>
																setModeByRecipe({
																	...modeByRecipe,
																	[recipe.id]: event.target.value,
																})
															}
														>
															{recipe.modes.map((mode) => (
																<option key={mode} value={mode}>
																	{mode}
																</option>
															))}
														</select>
														<button
															type='button'
															className='button secondary'
															disabled={
																!inventory.canInstallRecipes ||
																(recipe.type === 'infrastructure' &&
																	!inventory.canManageInfrastructure) ||
																pending ||
																!recipe.modes.length
															}
															onClick={() =>
																void perform(async () => {
																	await remote('recipes.install', {
																		id: recipe.id,
																		mode:
																			modeByRecipe[recipe.id] ??
																			recipe.modes[0],
																	});
																	await inspect();
																})
															}
														>
															Install
														</button>
														<button
															type='button'
															className='button secondary'
															disabled={
																!inventory.canInstallRecipes ||
																(recipe.type === 'infrastructure' &&
																	!inventory.canManageInfrastructure) ||
																pending
															}
															onClick={() =>
																void perform(async () => {
																	await remote('recipes.uninstall', {
																		id: recipe.id,
																	});
																	await inspect();
																})
															}
														>
															Uninstall
														</button>
													</div>
												</div>
											))}
										</div>
									)}
								</>
							)}
						</>
					)}
				</div>
			</div>
			{error && (
				<p className='error-message' role='alert'>
					{error}
				</p>
			)}
		</section>
	);
}
