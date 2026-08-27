// src/components/plugin-host/RecipeList.tsx
import type React from 'react';
import { useState, useEffect } from 'react';

import { t } from '@/i18n';
import { usePluginHost } from '../../hooks/usePluginHost';
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import {
	modeLabel,
	type InstallModeKind,
	type Recipe,
	type RecipeRuntimeState,
} from '../../plugin-host/types';
import IconButton from '../common/IconButton';
import {
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
import RecipeShareActions from './RecipeShareActions';
import RendezvousAvatars from './RendezvousAvatars';
import RecipeVariables from './RecipeVariables';

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
	const [browsing, setBrowsing] = useState(false);
	const [importing, setImporting] = useState(false);
	const [configuring, setConfiguring] = useState<Recipe | null>(null);
	const [selectionMode, setSelectionMode] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const busyView =
		editing !== null || browsing || importing || configuring !== null;
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
		(r) => stateOf(r.id) !== 'running' && r.modes.length === 1,
	);

	const runSelected = () => {
		for (const r of runnable) run(r.id);
	};
	const stopSelected = () => {
		for (const r of stoppable) stop(r.id);
	};
	const installSelected = () => {
		for (const r of installable) install(r.id, r.modes[0].kind);
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
				initialView={editingView}
				onDone={() => setEditing(null)}
			/>
		);
	}

	return (
		<div className='recipe-list'>
			<div className='recipe-list-header'>
				<div className='recipe-list-actions'>
					<button
						className='action-button primary'
						onClick={() => setBrowsing(true)}
					>
						<SearchIcon />
						{t('Browse recipes')}
					</button>
					<button
						className='action-button'
						onClick={() => openEditor('new', 'guided')}
					>
						<PlusIcon />
						{t('Add recipe')}
					</button>
					<button className='action-button' onClick={() => setImporting(true)}>
						<ImportIcon />
						{t('Import recipe')}
					</button>
				</div>

				{!selectionMode ? (
					<button
						className='button secondary smaller'
						onClick={() => setSelectionMode(true)}
						disabled={visibleRecipes.length === 0}
					>
						{t('Select recipes')}
					</button>
				) : (
					<div className='recipe-selection-controls'>
						<button className='button secondary smaller' onClick={selectAll}>
							{selected.size === visibleRecipes.length
								? t('Deselect All')
								: t('Select All')}
						</button>
						<button
							className='button primary smaller'
							onClick={runSelected}
							disabled={runnable.length === 0}
						>
							{t('Run')} ({runnable.length})
						</button>
						<button
							className='button smaller'
							onClick={installSelected}
							disabled={installable.length === 0}
						>
							{t('Install')} ({installable.length})
						</button>
						<button
							className='button danger smaller'
							onClick={stopSelected}
							disabled={stoppable.length === 0}
						>
							{t('Stop')} ({stoppable.length})
						</button>
						<button
							className='button secondary smaller'
							onClick={exitSelection}
						>
							{t('Cancel')}
						</button>
					</div>
				)}
			</div>

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
				const installed = state === 'installed' || state === 'stopped';
				const running = state === 'running';
				const modeKinds = recipe.modes.map((m) => m.kind);
				const hasVariables = !!recipe.variables && recipe.variables.length > 0;
				const updateVersion = updatesAvailable.get(recipe.id);
				const locked = starting || stopping;

				const beginInstall = (mode: InstallModeKind) => {
					setChoosingMode(null);
					install(recipe.id, mode);
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
								{status?.mode && (
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

						{status?.lastError && (
							<div className='recipe-error'>{status.lastError}</div>
						)}

						{choosingMode === recipe.id && (
							<div className='recipe-mode-picker'>
								<span className='recipe-mode-picker-label'>
									{t('Choose how to install:')}
								</span>
								{modeKinds.map((kind) => (
									<button
										key={kind}
										className='button'
										onClick={() => beginInstall(kind)}
									>
										{t(modeLabel(kind))}
									</button>
								))}
								<button
									className='button'
									onClick={() => setChoosingMode(null)}
								>
									{t('Cancel')}
								</button>
							</div>
						)}

						<div className='recipe-actions'>
							{!running && !starting && !stopping && (
								<button
									className='button'
									disabled={busy}
									onClick={() =>
										modeKinds.length === 1
											? beginInstall(modeKinds[0])
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
									className='button danger'
									onClick={() => cancelInstall(recipe.id)}
								>
									{t('Stop')}
								</button>
							) : running || stopping ? (
								<button
									className='button danger'
									disabled={stopping}
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
									className='button primary'
									disabled={busy || starting || stopping || !installed}
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
										disabled={busy}
										onClick={installUpdate}
									/>
								)}
								{hasVariables && (
									<IconButton
										icon={<SettingsIcon />}
										label={t('Settings')}
										tooltip={t('Edit the variables this recipe exposes.')}
										disabled={locked}
										onClick={() => setConfiguring(recipe)}
									/>
								)}
								<IconButton
									icon={<EditIcon />}
									label={t('Edit')}
									tooltip={t('Open this recipe in the editor.')}
									disabled={locked}
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
										disabled={busy || locked}
										onClick={() => uninstall(recipe.id)}
									/>
								)}
								<IconButton
									icon={<TrashIcon />}
									label={t('Remove')}
									tooltip={t('Delete this recipe from Chelys.')}
									variant='danger'
									disabled={locked}
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
