// src/components/plugin-host/RecipeList.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { usePluginHost } from '../../hooks/usePluginHost';
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import {
	modeLabel,
	type InstallModeKind,
	type Recipe,
	type RecipeRuntimeState,
} from '../../plugin-host/types';
import { PlusIcon, SearchIcon } from '../common/Icons';
import RecipeBrowser from './RecipeBrowser';
import RecipeForm from './RecipeForm';
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

const RecipeList: React.FC = () => {
	const {
		recipes,
		statuses,
		isReady,
		install,
		run,
		stop,
		remove,
		uninstall,
		updatesAvailable,
		registry,
		installFromRegistry,
	} = usePluginHost();
	const [editing, setEditing] = useState<Recipe | 'new' | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);
	const [choosingMode, setChoosingMode] = useState<string | null>(null);
	const [browsing, setBrowsing] = useState(false);
	const [configuring, setConfiguring] = useState<Recipe | null>(null);
	const [selectionMode, setSelectionMode] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());

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
			prev.size === recipes.length
				? new Set()
				: new Set(recipes.map((r) => r.id)),
		);
	};

	const exitSelection = () => {
		setSelectionMode(false);
		setSelected(new Set());
	};

	const stateOf = (id: string) => statuses.get(id)?.state ?? 'not-installed';
	const selectedRecipes = recipes.filter((r) => selected.has(r.id));

	const runnable = selectedRecipes.filter((r) =>
		['installed', 'stopped'].includes(stateOf(r.id)),
	);
	const stoppable = selectedRecipes.filter((r) => stateOf(r.id) === 'running');
	const installable = selectedRecipes.filter(
		(r) => stateOf(r.id) !== 'running' && r.modes.length === 1,
	);

	const runSelected = () => runnable.forEach((r) => run(r.id));
	const stopSelected = () => stoppable.forEach((r) => stop(r.id));
	const installSelected = () =>
		installable.forEach((r) => install(r.id, r.modes[0].kind));

	if (!isReady) return <p className='loading'>{t('Loading plugins…')}</p>;

	if (browsing) return <RecipeBrowser onDone={() => setBrowsing(false)} />;

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
				onDone={() => setEditing(null)}
			/>
		);
	}

	return (
		<div className='recipe-list'>
			<div className='recipe-list-header'>
				<h3>{t('Installed plugins')}</h3>
				<div className='recipe-list-actions'>
					<button className='action-button' onClick={() => setEditing('new')}>
						<PlusIcon />
						{t('Add plugin')}
					</button>
					<button className='action-button primary' onClick={() => setBrowsing(true)}>
						<SearchIcon />
						{t('Browse recipes')}
					</button>
				</div>
				<div className='recipe-selection-controls'>
					{!selectionMode ? (
						<button
							className='button secondary smaller'
							onClick={() => setSelectionMode(true)}
							disabled={recipes.length === 0}
						>
							{t('Select plugins')}
						</button>
					) : (
						<>
							<button className='button secondary smaller' onClick={selectAll}>
								{selected.size === recipes.length
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
							<button className='button secondary smaller' onClick={exitSelection}>
								{t('Cancel')}
							</button>
						</>
					)}
				</div>
			</div>

			{recipes.length === 0 && (
				<p className='no-recipes'>
					{t('No plugins yet. Add one to install and run a local server.')}
				</p>
			)}

			{recipes.map((recipe) => {
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
									<span className='recipe-version-badge'>v{recipe.version}</span>
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
							<span className={`recipe-state recipe-state-${state}`}>
								{t(STATE_LABELS[state])}
							</span>
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
							{running || stopping ? (
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
							{hasVariables && (
								<button
									className='button'
									disabled={starting || stopping}
									onClick={() => setConfiguring(recipe)}
								>
									{t('Settings')}
								</button>
							)}
							<button
								className='button'
								disabled={starting || stopping}
								onClick={() => setEditing(recipe)}
							>
								{t('Edit')}
							</button>
							{updateVersion && !running && !starting && !stopping && (
								<button
									className='button warn'
									disabled={busy}
									onClick={installUpdate}
								>
									{t('Update')}
								</button>
							)}
							{installed && (
								<button
									className='button danger'
									disabled={busy || starting || stopping}
									onClick={() => uninstall(recipe.id)}
								>
									{t('Uninstall')}
								</button>
							)}
							<button
								className='button'
								disabled={starting || stopping}
								onClick={() => remove(recipe.id)}
							>
								{t('Remove')}
							</button>
							{status && status.logTail.length > 0 && (
								<button
									className='button'
									onClick={() =>
										setExpanded(expanded === recipe.id ? null : recipe.id)
									}
								>
									{expanded === recipe.id ? t('Hide log') : t('Show log')}
								</button>
							)}
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
