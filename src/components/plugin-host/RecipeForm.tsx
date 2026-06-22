// src/components/plugin-host/RecipeForm.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { usePluginHost } from '../../hooks/usePluginHost';
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import {
	findMode,
	type InstallMode,
	type InstallStep,
	type Recipe,
} from '../../plugin-host/types';

interface RecipeFormProps {
	recipe: Recipe | null;
	onDone: () => void;
}

const splitArgs = (value: string): string[] =>
	value.trim() ? value.trim().split(/\s+/) : [];

const RecipeForm: React.FC<RecipeFormProps> = ({ recipe, onDone }) => {
	const { save, importRecipe } = usePluginHost();
	const types = pluginTypeRegistry.list();
	const systemMode = recipe ? findMode(recipe, 'system') : undefined;

	const [mode, setMode] = useState<'guided' | 'import'>('guided');
	const [type, setType] = useState(recipe?.type ?? types[0]?.type ?? 'lsp');
	const [name, setName] = useState(recipe?.name ?? '');
	const [runCommand, setRunCommand] = useState(
		systemMode?.runCommand.command ?? '',
	);
	const [runArgs, setRunArgs] = useState(
		systemMode?.runCommand.args.join(' ') ?? '',
	);
	const [installText, setInstallText] = useState(
		(systemMode?.installSteps ?? [])
			.map((s) => `${s.label} :: ${s.command} ${s.args.join(' ')}`)
			.join('\n'),
	);
	const [envText, setEnvText] = useState(
		Object.entries(recipe?.env ?? {})
			.map(([key, value]) => `${key}=${value}`)
			.join('\n'),
	);
	const [importText, setImportText] = useState('');
	const [error, setError] = useState<string | null>(null);

	const parseInstall = (): InstallStep[] =>
		installText
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [labelPart, commandPart] = line.split('::');
				const tokens = splitArgs(commandPart ?? labelPart);
				return {
					label: commandPart ? labelPart.trim() : tokens[0] ?? 'step',
					command: tokens[0] ?? '',
					args: tokens.slice(1),
				};
			});

	const parseEnv = (): Record<string, string> => {
		const env: Record<string, string> = {};
		for (const line of envText.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const eq = trimmed.indexOf('=');
			if (eq <= 0) continue;
			env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
		}
		return env;
	};

	const buildModes = (): InstallMode[] => {
		const system: InstallMode = {
			kind: 'system',
			installSteps: parseInstall(),
			runCommand: { command: runCommand, args: splitArgs(runArgs) },
		};
		const preserved = (recipe?.modes ?? []).filter((m) => m.kind !== 'system');
		const hasConnect = preserved.some((m) => m.kind === 'connect');
		return [
			system,
			...preserved,
			...(hasConnect ? [] : [{ kind: 'connect' as const }]),
		];
	};

	const handleSave = async () => {
		setError(null);
		try {
			if (mode === 'import') {
				await importRecipe(type, importText);
				onDone();
				return;
			}
			await save({
				id: recipe?.id ?? '',
				type,
				name: name || 'Untitled plugin',
				notes: recipe?.notes,
				env: parseEnv(),
				cwd: recipe?.cwd,
				modes: buildModes(),
				selectedMode: recipe?.selectedMode,
				typeConfig: recipe?.typeConfig ?? {},
			});
			onDone();
		} catch (e) {
			setError(e instanceof Error ? e.message : t('Could not save plugin'));
		}
	};

	return (
		<div className='recipe-form'>
			<div className='recipe-form-header'>
				<h3>{recipe ? t('Edit plugin') : t('Add plugin')}</h3>
				<div className='view-tabs'>
					<button
						className={`tab-button ${mode === 'guided' ? 'active' : ''}`}
						onClick={() => setMode('guided')}
					>
						{t('Guided')}
					</button>
					<button
						className={`tab-button ${mode === 'import' ? 'active' : ''}`}
						onClick={() => setMode('import')}
					>
						{t('Paste config')}
					</button>
				</div>
			</div>

			{error && <div className='error-message'>{error}</div>}

			{recipe?.notes && <div className='info-message'>{recipe.notes}</div>}

			<div className='form-group'>
				<label>{t('Plugin type')}</label>
				<select value={type} onChange={(e) => setType(e.target.value)}>
					{types.map((definition) => (
						<option key={definition.type} value={definition.type}>
							{definition.label}
						</option>
					))}
				</select>
			</div>

			{mode === 'import' ? (
				<div className='form-group'>
					<label>{t('Configuration')}</label>
					<textarea
						rows={10}
						spellCheck={false}
						value={importText}
						onChange={(e) => setImportText(e.target.value)}
						placeholder={t('Paste a TeXlyre LSP config block or recipe JSON')}
					/>
				</div>
			) : (
				<>
					<div className='form-group'>
						<label>{t('Name')}</label>
						<input value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className='form-group'>
						<label>{t('Run command')}</label>
						<input
							value={runCommand}
							onChange={(e) => setRunCommand(e.target.value)}
							placeholder='lsp-ws-proxy'
						/>
					</div>
					<div className='form-group'>
						<label>{t('Run arguments')}</label>
						<input
							value={runArgs}
							onChange={(e) => setRunArgs(e.target.value)}
							placeholder='-l 127.0.0.1:7020 -- ./bin/server'
						/>
					</div>
					<div className='form-group'>
						<label>{t('Install steps')}</label>
						<textarea
							rows={5}
							spellCheck={false}
							value={installText}
							onChange={(e) => setInstallText(e.target.value)}
							placeholder={t('One per line: Label :: command arg1 arg2')}
						/>
						<small>
							{t('Each step runs in order. Review commands before installing.')}
						</small>
					</div>
					<div className='form-group'>
						<label>{t('Environment variables')}</label>
						<textarea
							rows={3}
							spellCheck={false}
							value={envText}
							onChange={(e) => setEnvText(e.target.value)}
							placeholder='JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64'
						/>
						<small>
							{t('One per line as KEY=value. Passed to install and run commands.')}
						</small>
					</div>
				</>
			)}

			<div className='form-actions'>
				<button className='button' onClick={onDone}>
					{t('Cancel')}
				</button>
				<button className='button primary' onClick={handleSave}>
					{t('Save plugin')}
				</button>
			</div>
		</div>
	);
};

export default RecipeForm;
