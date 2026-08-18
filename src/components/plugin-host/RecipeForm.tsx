// src/components/plugin-host/RecipeForm.tsx
import type React from 'react';
import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

import { t } from '@/i18n';
import { usePluginHost } from '../../hooks/usePluginHost';
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import {
	dockerOf,
	isLocalDir,
	isRelative,
	rel,
	writeBackRelativeDockerfile,
	writeRecipeToDirectory,
} from '../../plugin-host/recipeDirectory';
import {
	findMode,
	type DockerMode,
	type FieldKind,
	type FieldSchema,
	type InstallMode,
	type InstallStep,
	type Recipe,
} from '../../plugin-host/types';

interface RecipeFormProps {
	recipe: Recipe | null;
	initialView?: 'guided' | 'files';
	onDone: () => void;
}

// 'file': real file (recipe.json, Dockerfile, icon) | 'view': slice of recipe.json (typeConfig) | 'reference': extraFiles path fetched on install
type PartKind = 'file' | 'view' | 'reference';

interface RecipePart {
	name: string;
	kind: PartKind;
	content: string | null;
	editable: boolean;
	image?: boolean;
	note?: string;
}

const NAME_FIELD = 'name';

const splitArgs = (value: string): string[] =>
	value.trim() ? value.trim().split(/\s+/) : [];

const stepsToText = (steps?: InstallStep[]): string =>
	(steps ?? [])
		.map((s) => `${s.label} :: ${s.command} ${s.args.join(' ')}`)
		.join('\n');

const parseSteps = (text: string): InstallStep[] =>
	text
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

const fieldToText = (kind: FieldKind, value: unknown): string => {
	if (value === undefined || value === null) return '';
	if (kind === 'list') {
		return Array.isArray(value) ? value.join(', ') : String(value);
	}
	if (kind === 'boolean') return value === true ? 'true' : 'false';
	if (kind === 'textarea' && typeof value !== 'string') {
		return JSON.stringify(value, null, 2);
	}
	return String(value);
};

const textToField = (
	kind: FieldKind,
	text: string,
	previous: unknown,
): unknown => {
	if (kind === 'list') {
		return text
			.split(/[\s,]+/)
			.map((entry) => entry.trim())
			.filter(Boolean);
	}
	if (kind === 'boolean') return text === 'true';
	if (kind === 'number') return text.trim() ? Number(text) : undefined;
	if (kind === 'textarea' && typeof previous !== 'string') {
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}
	return text.trim() ? text : undefined;
};

const typeConfigValues = (
	schema: FieldSchema[],
	typeConfig: Record<string, unknown> | undefined,
): Record<string, string> =>
	Object.fromEntries(
		schema
			.filter((field) => field.key !== NAME_FIELD)
			.map((field) => [
				field.key,
				fieldToText(field.kind, typeConfig?.[field.key]),
			]),
	);

const recipeToParts = (recipe: Recipe | null): RecipePart[] => {
	if (!recipe) {
		return [{ name: 'recipe.json', kind: 'file', content: '{}', editable: true }];
	}

	const { extraFiles, sourceUrl, icon, typeConfig, ...rest } = recipe;
	const docker = dockerOf(rest as Recipe);
	const stripped = {
		...rest,
		modes: rest.modes.map((m) =>
			m.kind === 'docker' ? { ...m, dockerfile: undefined } : m,
		),
	};

	const parts: RecipePart[] = [
		{
			name: 'recipe.json',
			kind: 'file',
			content: JSON.stringify(stripped, null, 2),
			editable: true,
		},
		{
			name: 'typeConfig',
			kind: 'view',
			content: JSON.stringify(typeConfig ?? {}, null, 2),
			editable: true,
		},
	];

	if (docker?.dockerfile) {
		const url = docker.dockerfileUrl;
		const editable = !url || (isRelative(url) && isLocalDir(sourceUrl));
		parts.push({
			name: 'Dockerfile',
			kind: 'file',
			content: docker.dockerfile,
			editable,
			note: editable
				? isRelative(url)
					? t('Edits are written back to {path} on save.', { path: rel(url) })
					: undefined
				: t('Read-only: dockerfileUrl points to a remote URL. Use a relative path or remove it to manage the Dockerfile in the recipe folder.'),
		});
	}

	if (icon) {
		parts.push({
			name: 'icon',
			kind: 'file',
			content: icon,
			editable: false,
			image: true,
			note: t('Read-only: iconUrl points to a remote URL. Use a relative path or remove it to manage the icon in the recipe folder.'),
		});
	}

	for (const path of extraFiles ?? []) {
		parts.push({ name: path, kind: 'reference', content: null, editable: false });
	}

	return parts;
};

const partsToRecipe = (parts: RecipePart[], fallbackId: string): Recipe => {
	const json = parts.find((p) => p.name === 'recipe.json')?.content;
	if (!json) throw new Error('recipe.json is required');

	const recipe = JSON.parse(json) as Recipe;
	recipe.id = recipe.id || fallbackId;

	const typeConfig = parts.find((p) => p.name === 'typeConfig')?.content;
	if (typeConfig) {
		recipe.typeConfig = JSON.parse(typeConfig) as Record<string, unknown>;
	}

	const dockerfile = parts.find(
		(p) => p.kind === 'file' && p.name.toLowerCase() === 'dockerfile',
	)?.content;
	if (dockerfile) {
		recipe.modes = (recipe.modes ?? []).map((m) =>
			m.kind === 'docker' ? { ...m, dockerfile } : m,
		);
	}

	const icon = parts.find((p) => p.image)?.content;
	if (icon) recipe.icon = icon;

	const extras = parts.filter((p) => p.kind === 'reference').map((p) => p.name);
	recipe.extraFiles = extras.length > 0 ? extras : undefined;

	return recipe;
};

const RecipeForm: React.FC<RecipeFormProps> = ({
	recipe,
	initialView = 'guided',
	onDone,
}) => {
	const { save } = usePluginHost();
	const types = pluginTypeRegistry.list();
	const systemMode = recipe ? findMode(recipe, 'system') : undefined;
	const dockerMode = recipe ? dockerOf(recipe) : undefined;

	const [mode, setMode] = useState<'guided' | 'files'>(initialView);
	const [type, setType] = useState(recipe?.type ?? types[0]?.type ?? 'lsp');
	const [name, setName] = useState(recipe?.name ?? '');
	const [runCommand, setRunCommand] = useState(systemMode?.runCommand.command ?? '');
	const [runArgs, setRunArgs] = useState(systemMode?.runCommand.args.join(' ') ?? '');
	const [installText, setInstallText] = useState(stepsToText(systemMode?.installSteps));
	const [uninstallText, setUninstallText] = useState(stepsToText(systemMode?.uninstallSteps));
	const [dockerImage, setDockerImage] = useState(dockerMode?.image ?? '');
	const [envText, setEnvText] = useState(
		Object.entries(recipe?.env ?? {})
			.map(([key, value]) => `${key}=${value}`)
			.join('\n'),
	);
	const [typeValues, setTypeValues] = useState<Record<string, string>>(() =>
		typeConfigValues(
			pluginTypeRegistry.get(recipe?.type ?? type)?.formSchema ?? [],
			recipe?.typeConfig,
		),
	);
	const [parts, setParts] = useState<RecipePart[]>(() => recipeToParts(recipe));
	const [sourceUrl] = useState(recipe?.sourceUrl ?? '');
	const [selectedPart, setSelectedPart] = useState('recipe.json');
	const [error, setError] = useState<string | null>(null);

	const schema = pluginTypeRegistry.get(type)?.formSchema ?? [];
	const selected = parts.find((p) => p.name === selectedPart);

	useEffect(() => {
		setTypeValues(
			typeConfigValues(
				pluginTypeRegistry.get(type)?.formSchema ?? [],
				recipe?.typeConfig,
			),
		);
	}, [type, recipe]);

	const parseEnv = (): Record<string, string> => {
		const env: Record<string, string> = {};
		for (const line of envText.split('\n')) {
			const eq = line.indexOf('=');
			if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
		}
		return env;
	};

	const buildTypeConfig = (): Record<string, unknown> => {
		const next: Record<string, unknown> = { ...(recipe?.typeConfig ?? {}) };

		for (const field of schema) {
			if (field.key === NAME_FIELD) continue;

			const value = textToField(
				field.kind,
				typeValues[field.key] ?? '',
				recipe?.typeConfig?.[field.key],
			);

			if (value === undefined) delete next[field.key];
			else next[field.key] = value;
		}

		return next;
	};

	const buildModes = (): InstallMode[] => {
		const system: InstallMode = {
			...(systemMode ?? { kind: 'system' as const }),
			kind: 'system',
			installSteps: parseSteps(installText),
			uninstallSteps: parseSteps(uninstallText),
			runCommand: { command: runCommand, args: splitArgs(runArgs) },
		};
		const image = dockerImage.trim();
		const docker: DockerMode | null = image
			? {
				...(dockerMode ?? { kind: 'docker' as const, buildSteps: [], runArgs: [] }),
				kind: 'docker',
				image,
			}
			: null;
		const preserved = (recipe?.modes ?? []).filter(
			(m) => m.kind !== 'system' && m.kind !== 'docker',
		);
		return [
			system,
			...(docker ? [docker] : []),
			...preserved,
			...(preserved.some((m) => m.kind === 'connect')
				? []
				: [{ kind: 'connect' as const }]),
		];
	};

	const buildRecipe = (): Recipe => {
		if (mode === 'files') {
			const built = partsToRecipe(parts, recipe?.id ?? '');
			if (sourceUrl) built.sourceUrl = sourceUrl;
			return built;
		}
		return {
			...recipe,
			id: recipe?.id ?? '',
			type,
			name: name || 'Untitled recipe',
			env: parseEnv(),
			modes: buildModes(),
			typeConfig: buildTypeConfig(),
			sourceUrl: sourceUrl || recipe?.sourceUrl,
		};
	};

	const updateSelectedPart = (content: string) => {
		setParts((prev) =>
			prev.map((p) => (p.name === selectedPart ? { ...p, content } : p)),
		);
	};

	const handleSave = async () => {
		setError(null);
		try {
			const built = buildRecipe();
			await save(built);
			await writeBackRelativeDockerfile(built);
			onDone();
		} catch (e) {
			setError(e instanceof Error ? e.message : t('Could not save recipe'));
		}
	};

	const handleSaveToDisk = async () => {
		setError(null);
		try {
			const built = buildRecipe();
			const dir = await openDialog({
				directory: true,
				title: t('Choose the recipe directory'),
			});
			if (typeof dir !== 'string') return;

			await writeRecipeToDirectory(built, dir);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const modeTab = (id: typeof mode, label: string) => (
		<button
			className={`tab-button ${mode === id ? 'active' : ''}`}
			onClick={() => setMode(id)}
		>
			{label}
		</button>
	);

	const renderSchemaField = (field: FieldSchema) => {
		const value = typeValues[field.key] ?? '';
		const id = `recipe-type-${field.key}`;

		return (
			<div key={field.key} className='form-group'>
				<label htmlFor={id}>{t(field.label)}</label>
				{field.kind === 'boolean' ? (
					<input
						id={id}
						type='checkbox'
						checked={value === 'true'}
						onChange={(e) =>
							setTypeValues((prev) => ({
								...prev,
								[field.key]: e.target.checked ? 'true' : 'false',
							}))
						}
					/>
				) : field.kind === 'textarea' ? (
					<textarea
						id={id}
						rows={6}
						spellCheck={false}
						dir='ltr'
						value={value}
						onChange={(e) =>
							setTypeValues((prev) => ({ ...prev, [field.key]: e.target.value }))
						}
					/>
				) : (
					<input
						id={id}
						type={field.kind === 'number' ? 'number' : 'text'}
						dir='ltr'
						value={value}
						placeholder={field.placeholder}
						onChange={(e) =>
							setTypeValues((prev) => ({ ...prev, [field.key]: e.target.value }))
						}
					/>
				)}
				{field.help && <small>{t(field.help)}</small>}
			</div>
		);
	};

	return (
		<div className='recipe-form'>
			<div className='recipe-form-header'>
				<h3>{recipe ? t('Edit recipe') : t('Add recipe')}</h3>
				<div className='view-tabs'>
					{modeTab('guided', t('Guided'))}
					{modeTab('files', t('Files'))}
				</div>
			</div>

			{error && <div className='error-message'>{error}</div>}
			{recipe?.notes && <div className='info-message'>{recipe.notes}</div>}

			{mode === 'files' ? (
				<>
					<div className='form-group'>
						<div className='view-tabs recipe-parts'>
							{parts.map((part) => (
								<button
									key={part.name}
									className={`tab-button ${!part.editable ? 'part-readonly ' : ''}${part.name === selectedPart ? 'active' : ''
										}`}
									onClick={() => setSelectedPart(part.name)}
								>
									{part.name}
									{part.kind === 'view' && (
										<span className='recipe-type-badge'>recipe.json</span>
									)}
								</button>
							))}
						</div>
					</div>

					{selected?.kind === 'reference' ? (
						<div className='form-group'>
							<div className='info-message'>
								{t('Fetched from the recipe source into the working directory on install.')}
							</div>
						</div>
					) : selected?.image ? (
						<div className='form-group'>
							{selected.note && (
								<div className='warning-message'>
									<p>{selected.note}</p>
								</div>
							)}
							<div
								className='recipe-icon-preview'
								dangerouslySetInnerHTML={{ __html: selected.content ?? '' }}
							/>
						</div>
					) : selected ? (
						<div className='form-group'>
							{selected.note &&
								(selected.editable ? (
									<small>{selected.note}</small>
								) : (
									<div className='warning-message'>
										<p>{selected.note}</p>
									</div>
								))}
							<textarea
								rows={16}
								spellCheck={false}
								dir='ltr'
								value={selected.content ?? ''}
								readOnly={!selected.editable}
								onChange={(e) => updateSelectedPart(e.target.value)}
							/>
						</div>
					) : null}
				</>
			) : (
				<>
					<div className='form-group'>
						<label htmlFor='recipe-type'>{t('Recipe type')}</label>
						<select
							id='recipe-type'
							value={type}
							onChange={(e) => setType(e.target.value)}
						>
							{types.map((definition) => (
								<option key={definition.type} value={definition.type}>
									{definition.label}
								</option>
							))}
						</select>
					</div>
					<div className='form-group'>
						<label htmlFor='recipe-name'>{t('Name')}</label>
						<input
							id='recipe-name'
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>

					{schema.length > 0 && (
						<>
							<h4 className='recipe-form-section'>{t('Configuration')}</h4>
							{schema
								.filter((field) => field.key !== NAME_FIELD)
								.map(renderSchemaField)}
						</>
					)}

					<h4 className='recipe-form-section'>{t('Runtime')}</h4>
					<div className='form-group'>
						<label htmlFor='recipe-run-command'>{t('Run command')}</label>
						<input
							id='recipe-run-command'
							value={runCommand}
							onChange={(e) => setRunCommand(e.target.value)}
							placeholder='lsp-ws-proxy'
						/>
					</div>
					<div className='form-group'>
						<label htmlFor='recipe-run-args'>{t('Run arguments')}</label>
						<input
							id='recipe-run-args'
							value={runArgs}
							onChange={(e) => setRunArgs(e.target.value)}
							placeholder='-l 127.0.0.1:7020 -- ./bin/server'
						/>
					</div>
					<div className='form-group'>
						<label htmlFor='recipe-install-steps'>{t('Install steps')}</label>
						<textarea
							id='recipe-install-steps'
							rows={5}
							spellCheck={false}
							value={installText}
							onChange={(e) => setInstallText(e.target.value)}
							placeholder={t('One per line: Label :: command arg1 arg2')}
						/>
						<small>{t('Each step runs in order. Review commands before installing.')}</small>
					</div>
					<div className='form-group'>
						<label htmlFor='recipe-uninstall-steps'>{t('Uninstall steps')}</label>
						<textarea
							id='recipe-uninstall-steps'
							rows={3}
							spellCheck={false}
							value={uninstallText}
							onChange={(e) => setUninstallText(e.target.value)}
							placeholder={t('One per line: Label :: command arg1 arg2')}
						/>
					</div>
					<div className='form-group'>
						<label htmlFor='recipe-docker-image'>{t('Docker image')}</label>
						<input
							id='recipe-docker-image'
							value={dockerImage}
							onChange={(e) => setDockerImage(e.target.value)}
							placeholder='traefik:3.7.8'
						/>
						<small>{t('Container image used in Docker mode. Leave empty to remove Docker mode.')}</small>
					</div>
					<div className='form-group'>
						<label htmlFor='recipe-env'>{t('Environment variables')}</label>
						<textarea
							id='recipe-env'
							rows={3}
							spellCheck={false}
							value={envText}
							onChange={(e) => setEnvText(e.target.value)}
							placeholder='JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64'
						/>
						<small>{t('One per line as KEY=value. Passed to install and run commands.')}</small>
					</div>
				</>
			)}

			<div className='form-actions'>
				<button className='button' onClick={handleSaveToDisk}>
					{t('Save to directory')}
				</button>
				<button className='button secondary' onClick={onDone}>
					{t('Cancel')}
				</button>
				<button className='button primary' onClick={handleSave}>
					{t('Save recipe')}
				</button>
			</div>
		</div>
	);
};

export default RecipeForm;
