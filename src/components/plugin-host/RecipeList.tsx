// src/components/plugin-host/RecipeList.tsx
import type React from 'react';
import { useCallback, useState, useEffect, useRef } from 'react';

import { t } from '@/i18n';
import { usePluginHost } from '../../hooks/usePluginHost';
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import {
	findMode,
	modeLabel,
	type DockerInstallSource,
	type InstallModeKind,
	type Recipe,
	type RecipeRuntimeState,
} from '../../plugin-host/types';
import IconButton from '@texlyre/components/common/IconButton';
import {
	ChevronDownIcon,
	DownloadIcon,
	EditIcon,
	ImportIcon,
	PlusIcon,
	RefreshIcon,
	SearchIcon,
	SettingsIcon,
	TerminalIcon,
	TrashIcon,
	UninstallIcon,
} from '../common/Icons';
import RecipeBrowser from './RecipeBrowser';
import RecipeForm from './RecipeForm';
import RecipeImport from './RecipeImport';
import { localCommand } from '../../control/localClient';
import RecipeShareActions from './RecipeShareActions';
import RendezvousAvatars from './RendezvousAvatars';
import RecipeVariables from './RecipeVariables';
import { bulkInstallOptions, canBulkInstall, recipeInstallOptions } from '../../plugin-host/installOptions';
import PositionedDropdown from '@texlyre/components/common/PositionedDropdown';

const STATE_LABELS: Record<RecipeRuntimeState, string> = {
	'not-installed': 'Not installed',
	installing: 'Installing…',
	installed: 'Installed',
	starting: 'Starting…',
	running: 'Running',
	stopping: 'Stopping…',
	stopped: 'Stopped',
	error: 'Error',
};

interface RecipeListProps {
	category?: string;
	onBusyChange?: (busy: boolean) => void;
}

const RecipeList: React.FC<RecipeListProps> = ({ category, onBusyChange }) => {
	const {
		recipes,
		members,
		statuses,
		isReady,
		install,
		run,
		stop,
		cancelInstall,
		remove,
		uninstall,
		updatesAvailable,
		registry,
		installFromRegistry,
	} = usePluginHost();

	const exclusiveTypes = new Set(pluginTypeRegistry.exclusiveTypes());
	const visibleRecipes = recipes.filter((r) =>
		category ? r.type === category : !exclusiveTypes.has(r.type),
	);
	const [editing, setEditing] = useState<Recipe | 'new' | null>(null);
	const [editingView, setEditingView] = useState<'guided' | 'files'>('guided');
	const [expanded, setExpanded] = useState<string | null>(null);
	const [choosingMode, setChoosingMode] = useState<string | null>(null);
	const [installMenu, setInstallMenu] = useState<string | null>(null);
	const [installAnchor, setInstallAnchor] = useState<HTMLElement | null>(null);
	const [bulkAnchor, setBulkAnchor] = useState<HTMLElement | null>(null);
	const [bulkRunning, setBulkRunning] = useState(false);
	const [bulkResult, setBulkResult] = useState('');
    const [checking, setChecking] = useState<string | null>(null);
    const [checkError, setCheckError] = useState('');
	const bulkLock = useRef(false);
	const latest = useRef({ recipes, statuses });
	latest.current = { recipes, statuses };
	const [browsing, setBrowsing] = useState(false);
	const [importing, setImporting] = useState(false);
	const [configuring, setConfiguring] = useState<Recipe | null>(null);
	const [selectionMode, setSelectionMode] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const listScrollTop = useRef(0);
	const restoreListScroll = useCallback((node: HTMLDivElement | null) => {
		if (node) node.scrollTop = listScrollTop.current;
	}, []);

	const busyView =
		editing !== null || browsing || importing || configuring !== null || bulkRunning;
	useEffect(() => {
		onBusyChange?.(busyView);
	}, [busyView, onBusyChange]);

	const toggleSelected = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const selectAll = () => {
		setSelected((prev) =>
			prev.size === visibleRecipes.length
				? new Set()
				: new Set(visibleRecipes.map((r) => r.id)),
		);
	};

	const exitSelection = () => {
		setBulkAnchor(null);
		setBulkResult('');
		setSelectionMode(false);
		setSelected(new Set());
	};

	const openEditor = (recipe: Recipe | 'new', view: 'guided' | 'files') => {
		setEditingView(view);
		setEditing(recipe);
	};

	const stateOf = (id: string) => statuses.get(id)?.state ?? 'not-installed';
	const selectedRecipes = visibleRecipes.filter((r) => selected.has(r.id));

	const runnable = selectedRecipes.filter((r) =>
		['installed', 'stopped'].includes(stateOf(r.id)),
	);
	const stoppable = selectedRecipes.filter((r) => stateOf(r.id) === 'running');
	const installable = selectedRecipes.filter(
		(r) => canBulkInstall(r, stateOf(r.id)),
	);

	const runSelected = () => {
		for (const r of runnable) run(r.id);
	};
	const stopSelected = () => {
		for (const r of stoppable) stop(r.id);
	};
	const groups = bulkInstallOptions(installable);
	const installSelected = async (group: (typeof groups)[number]) => {
		if (bulkLock.current) return;
		bulkLock.current = true;
		setBulkAnchor(null);
		setChoosingMode(null);
		setInstallMenu(null);
		setInstallAnchor(null);
		setBulkRunning(true);
		setBulkResult('');
		let installed = 0;
		const failed: string[] = [];
		try {
			for (const { recipe } of group.targets) {
				const current = latest.current.recipes.find((item) => item.id === recipe.id);
				const option = current && recipeInstallOptions(current).find((item) => item.id === group.id);
				if (!current || !option || !canBulkInstall(current, latest.current.statuses.get(recipe.id)?.state ?? 'not-installed')) {
					failed.push(recipe.name);
					continue;
				}
				try {
					await install(recipe.id, option.mode, option.source);
					installed++;
				} catch {
					failed.push(recipe.name);
				}
			}
		} finally {
			setBulkResult(`${t('Installed')} ${installed}/${group.targets.length}${failed.length ? ` · ${t('Failed or skipped')}: ${failed.join(', ')}` : ''}`);
			setBulkRunning(false);
			bulkLock.current = false;
		}
	};

	if (!isReady) return <p className='loading'>{t('Loading recipes…')}</p>;

	if (browsing)
		return (
			<RecipeBrowser category={category} onDone={() => setBrowsing(false)} />
		);

	if (importing) {
		return (
			<RecipeImport
				category={category}
				onImported={(recipe) => {
					setImporting(false);
					openEditor(recipe, 'files');
				}}
				onCancel={() => setImporting(false)}
			/>
		);
	}

	if (configuring) {
		return (
			<RecipeVariables
				recipe={configuring}
				onDone={() => setConfiguring(null)}
			/>
		);
	}

	if (editing) {
		return (
			<RecipeForm
				recipe={editing === 'new' ? null : editing}
                category={category}
				initialView={editingView}
				onDone={() => setEditing(null)}
			/>
		);
	}

	return (
		<div
			className='recipe-list'
			ref={restoreListScroll}
			onScroll={(event) => {
				listScrollTop.current = event.currentTarget.scrollTop;
			}}
		>
			<div className='recipe-list-header'>
				<div className='recipe-list-actions'>
					<button
						type='button'
						className='button action-button primary'
						disabled={bulkRunning}
						onClick={() => setBrowsing(true)}
					>
						<SearchIcon />
						{t('Browse recipes')}
					</button>
					<button
						type='button'
						className='button action-button'
						disabled={bulkRunning}
						onClick={() => openEditor('new', 'guided')}
					>
						<PlusIcon />
						{t('Add recipe')}
					</button>
					<button
						type='button'
						className='button action-button'
						disabled={bulkRunning}
						onClick={() => setImporting(true)}
					>
						<ImportIcon />
						{t('Import recipe')}
					</button>
				</div>

				{!selectionMode ? (
					<button
						type='button'
						className='button secondary smaller'
						onClick={() => setSelectionMode(true)}
						disabled={visibleRecipes.length === 0}
					>
						{t('Select recipes')}
					</button>
				) : (
					<div className='recipe-selection-controls'>
						<button
							type='button'
							className='button secondary smaller'
							disabled={bulkRunning}
							onClick={selectAll}
						>
							{selected.size === visibleRecipes.length
								? t('Deselect All')
								: t('Select All')}
						</button>
						<button
							type='button'
							className='button primary smaller'
							onClick={runSelected}
							disabled={bulkRunning || runnable.length === 0}
						>
							{t('Run')} ({runnable.length})
						</button>
						<button
							type='button'
							className='button smaller'
							onClick={(event) => setBulkAnchor(bulkAnchor ? null : event.currentTarget)}
							aria-expanded={!!bulkAnchor}
							disabled={bulkRunning || installable.length === 0}
						>
							{t('Install')} ({installable.length}) <ChevronDownIcon />
						</button>
						<PositionedDropdown isOpen={!!bulkAnchor && !bulkRunning} triggerElement={bulkAnchor} onClose={() => setBulkAnchor(null)}>
							{groups.map((group) => (
								<button key={group.id} type='button' className='ui-menu-item' onClick={() => void installSelected(group)}>
									{t(group.label)} ({group.targets.length}/{installable.length})
								</button>
							))}
						</PositionedDropdown>
						<button
							type='button'
							className='button danger smaller'
							onClick={stopSelected}
							disabled={bulkRunning || stoppable.length === 0}
						>
							{t('Stop')} ({stoppable.length})
						</button>
						<button
							type='button'
							className='button secondary smaller'
							disabled={bulkRunning}
							onClick={exitSelection}
						>
							{t('Cancel')}
						</button>
					</div>
				)}
			</div>

			{selectionMode && (bulkRunning || bulkResult) && <p role='status'>{bulkRunning ? t('Installing recipes…') : bulkResult}</p>}
			{visibleRecipes.length === 0 && (
				<p className='no-recipes'>
					{t('No recipes yet. Add one to install and run a local server.')}
				</p>
			)}

			{visibleRecipes.map((recipe) => {
				const status = statuses.get(recipe.id);
				const state = status?.state ?? 'not-installed';
				const definition = pluginTypeRegistry.get(recipe.type);
				const typeLabel = definition?.label ?? recipe.type;
				const icon = recipe.icon ?? definition?.icon;
				const busy = state === 'installing';
				const starting = state === 'starting';
				const stopping = state === 'stopping';
				const isService = recipe.type === 'service';
                const installed = state === 'installed' || state === 'stopped' || (isService && state === 'error' && status?.mode === 'connect');
				const running = state === 'running' || !!status?.groupActive;
				const modeKinds = recipe.modes.map((m) => m.kind);
				const hasVariables = !!recipe.variables && recipe.variables.length > 0;
				const updateVersion = updatesAvailable.get(recipe.id);
				const locked = starting || stopping;

				const docker = findMode(recipe, 'docker');
				const configurable = hasVariables || !!docker;
				const options = recipeInstallOptions(recipe);
				const pullable = options.some((option) => option.id === 'docker-build') && options.some((option) => option.id === 'docker-registry');

				const beginInstall = (
					mode: InstallModeKind,
					source?: DockerInstallSource,
				) => {
					setChoosingMode(null);
					setInstallMenu(null);
					setInstallAnchor(null);
					install(recipe.id, mode, source);
				};

				const installUpdate = () => {
					const entry = registry.find((e) => e.id === recipe.id);
					if (entry) installFromRegistry(entry, updateVersion);
				};

				return (
					<div key={recipe.id} className='recipe-card'>
						<div className='recipe-card-main'>
							<div className='recipe-card-info'>
								{selectionMode && (
									<input
										type='checkbox'
										className='recipe-select'
										checked={selected.has(recipe.id)}
										disabled={bulkRunning}
										onChange={() => toggleSelected(recipe.id)}
									/>
								)}
								{icon && (
									<span
										className='recipe-icon'
										aria-hidden='true'
										dangerouslySetInnerHTML={{ __html: icon }}
									/>
								)}
								<span className='recipe-name'>{recipe.name}</span>
								{recipe.version && (
									<span className='recipe-version-badge'>
										v{recipe.version}
									</span>
								)}
								{updateVersion && (
									<span className='recipe-update-badge'>
										{t('Update → v{version}', { version: updateVersion })}
									</span>
								)}
								<span className='recipe-type-badge'>{typeLabel}</span>
								{status?.mode && !isService && (
									<span className='recipe-mode-badge'>
										{t(modeLabel(status.mode))}
									</span>
								)}
							</div>
							<div className='recipe-card-status'>
								<RendezvousAvatars recipe={recipe} active={running} />
								<span className={`recipe-state recipe-state-${state}`}>
									{t(STATE_LABELS[state])}
								</span>
							</div>
						</div>

                        {isService && <div className='recipe-members'>
                            {(members[recipe.id] ?? []).map(member => {
                                const count = Object.values(members).filter(group => group.some(other => other.local === member.local && (member.local ? other.recipeId === member.recipeId : other.reference === member.reference))).length;
                                return <div key={member.reference} className='recipe-card-main'>
                                    <div className='recipe-card-info'><span>{member.name}</span><small title={member.reference}>{member.local ? t('Local') : member.reference.split('/')[0]}</small>{count > 1 && <small>{t('Shared')} · {count}</small>}</div>
                                    <small className={`recipe-state recipe-state-${member.state}`}>{member.local ? (STATE_LABELS[member.state as RecipeRuntimeState] ?? member.state) : `${member.state}${member.state === 'running' ? ' (last checked)' : ''}`}</small>
                                </div>;
                            })}
                            <small>{t('Stopping or removing a service leaves its plugins running.')}</small>
                            {(members[recipe.id] ?? []).some(member => !member.local) && <button type='button' className='button' disabled={checking !== null || busy || locked} onClick={() => { setChecking(recipe.id); setCheckError(''); void localCommand('recipes.service.check', { id: recipe.id }).catch(error => setCheckError(String(error))).finally(() => setChecking(null)); }}>{checking === recipe.id ? t('Checking…') : t('Check members')}</button>}
                            {checkError && <small role='alert'>{checkError}</small>}
                        </div>}
						{status?.lastError && (
							<div className='recipe-error'>{status.lastError}</div>
						)}

						{choosingMode === recipe.id && (
							<div className='recipe-mode-picker'>
								<span className='recipe-mode-picker-label'>
									{t('Choose how to install:')}
								</span>
								{modeKinds.map((kind) =>
									kind === 'docker' && pullable && docker ? (
										<div key={kind} className='ui-menu-anchor' data-width='content'>
											<div className='ui-button-group ui-split-button' data-variant='joined'>
												<button type='button' className='button ui-split-main' onClick={() => beginInstall('docker')}>{t(modeLabel('docker'))}</button>
												<button type='button' className='button ui-split-toggle' aria-expanded={installMenu === recipe.id} title={t('Container install options')} onClick={(event) => {
													setInstallAnchor(installMenu === recipe.id ? null : event.currentTarget);
													setInstallMenu(installMenu === recipe.id ? null : recipe.id);
												}}><ChevronDownIcon /></button>
											</div>
											<PositionedDropdown isOpen={installMenu === recipe.id} triggerElement={installAnchor} onClose={() => { setInstallMenu(null); setInstallAnchor(null); }}>
												<button type='button' className='ui-menu-item' onClick={() => beginInstall('docker')}><TerminalIcon /><span>{t('Build image locally')}</span></button>
												<button type='button' className='ui-menu-item' title={docker.image} onClick={() => beginInstall('docker', 'registry')}><DownloadIcon /><span>{t('Pull container image')}</span></button>
											</PositionedDropdown>
										</div>
									) : (
										<button
											type='button'
											key={kind}
											className='button'
											onClick={() => beginInstall(kind)}
										>
											{t(modeLabel(kind))}
										</button>
									),
								)}
								<button
									type='button'
									className='button'
									onClick={() => {
										setChoosingMode(null);
										setInstallMenu(null);
										setInstallAnchor(null);
									}}
								>
									{t('Cancel')}
								</button>
							</div>
						)}

						<div className='recipe-actions'>
							{!running && !starting && !stopping && (
								<button
									type='button'
									className='button'
									disabled={bulkRunning || busy || options.length === 0}
									onClick={() =>
										options.length === 1
											? beginInstall(options[0].mode, options[0].source)
											: setChoosingMode(
													choosingMode === recipe.id ? null : recipe.id,
												)
									}
								>
									{installed ? t('Reinstall') : t('Install')}
								</button>
							)}
							{busy ? (
								<button
									type='button'
									className='button danger'
									onClick={() => cancelInstall(recipe.id)}
								>
									{t('Stop')}
								</button>
							) : running || stopping ? (
								<button
									type='button'
									className='button danger'
									disabled={bulkRunning || stopping}
									onClick={() => stop(recipe.id)}
								>
									{stopping ? (
										<>
											<span className='loading-spinner inline' />
											{t('Stopping…')}
										</>
									) : (
										t('Stop')
									)}
								</button>
							) : (
								<button
									type='button'
									className='button primary'
									disabled={bulkRunning || busy || starting || stopping || !installed}
									onClick={() => run(recipe.id)}
								>
									{starting ? (
										<>
											<span className='loading-spinner inline' />
											{t('Starting…')}
										</>
									) : (
										t('Run')
									)}
								</button>
							)}

							<div className='recipe-actions-utility'>
								{updateVersion && !running && !starting && !stopping && (
									<IconButton
										icon={<RefreshIcon />}
										label={t('Update')}
										tooltip={t('Install v{version} from the registry.', {
											version: updateVersion,
										})}
										variant='warn'
										disabled={bulkRunning || busy}
										onClick={installUpdate}
									/>
								)}
								{configurable && (
									<IconButton
										icon={<SettingsIcon />}
										label={t('Settings')}
										tooltip={t('Configure this recipe.')}
										disabled={bulkRunning || locked}
										onClick={() => setConfiguring(recipe)}
									/>
								)}
								<IconButton
									icon={<EditIcon />}
									label={t('Edit')}
									tooltip={t('Open this recipe in the editor.')}
									disabled={bulkRunning || locked || (isService && running)}
									onClick={() => openEditor(recipe, 'guided')}
								/>
								<RecipeShareActions
									recipe={recipe}
									transportLocked={running || locked}
								/>
								{status && status.logTail.length > 0 && (
									<IconButton
										icon={<TerminalIcon />}
										label={
											expanded === recipe.id ? t('Hide log') : t('Show log')
										}
										onClick={() =>
											setExpanded(expanded === recipe.id ? null : recipe.id)
										}
									/>
								)}
								{installed && (
									<IconButton
										icon={<UninstallIcon />}
										label={t('Uninstall')}
										tooltip={t('Run the uninstall steps but keep the recipe.')}
										variant='danger'
										disabled={bulkRunning || busy || locked}
										onClick={() => uninstall(recipe.id)}
									/>
								)}
								<IconButton
									icon={<TrashIcon />}
									label={t('Remove')}
									tooltip={t('Delete this recipe from Chelys.')}
									variant='danger'
									disabled={bulkRunning || locked}
									onClick={() => remove(recipe.id)}
								/>
							</div>
						</div>

						{expanded === recipe.id && status && (
							<pre className='recipe-log'>{status.logTail.join('\n')}</pre>
						)}
					</div>
				);
			})}
		</div>
	);
};

export default RecipeList;
