// src/components/plugin-host/RecipeForm.tsx
import type React from 'react';
import { useState } from 'react';
import { join } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
	BaseDirectory,
	mkdir,
	readDir,
	readFile,
	readTextFile,
	writeTextFile,
} from '@tauri-apps/plugin-fs';

import { t } from '@/i18n';
import { recipeDirName } from '../../plugin-host/recipeWorkdir';
import { usePluginHost } from '../../hooks/usePluginHost';
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import {
	findMode,
	type DockerMode,
	type InstallMode,
	type InstallStep,
	type Recipe,
} from '../../plugin-host/types';

interface RecipeFormProps {
	recipe: Recipe | null;
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

const isUrl = (value?: string): boolean => !!value && /^https?:\/\//i.test(value);
const isRelative = (value?: string): value is string => !!value && !isUrl(value);
const rel = (path: string): string => path.replace(/^\.\//, '');
const isLocalDir = (source?: string): boolean => !!source && !isUrl(source);
const dockerOf = (recipe: Recipe): DockerMode | undefined =>
	findMode(recipe, 'docker') as DockerMode | undefined;

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

const inlineIconFromDir = async (dir: string, path: string): Promise<string> => {
	if (/\.svg$/i.test(path)) return readTextFile(await join(dir, path));
	const bytes = await readFile(await join(dir, path));
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return `<img src="data:image/png;base64,${btoa(binary)}" alt="" />`;
};

const RecipeForm: React.FC<RecipeFormProps> = ({ recipe, onDone }) => {
	const { save, importRecipe } = usePluginHost();
	const types = pluginTypeRegistry.list();
	const systemMode = recipe ? findMode(recipe, 'system') : undefined;
	const dockerMode = recipe ? dockerOf(recipe) : undefined;

	const [mode, setMode] = useState<'guided' | 'files' | 'import'>('guided');
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
	const [parts, setParts] = useState<RecipePart[]>(() => recipeToParts(recipe));
	const [sourceUrl, setSourceUrl] = useState(recipe?.sourceUrl ?? '');
	const [selectedPart, setSelectedPart] = useState('recipe.json');
	const [importText, setImportText] = useState('');
	const [error, setError] = useState<string | null>(null);

	const selected = parts.find((p) => p.name === selectedPart);

	const parseEnv = (): Record<string, string> => {
		const env: Record<string, string> = {};
		for (const line of envText.split('\n')) {
			const eq = line.indexOf('=');
			if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
		}
		return env;
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
			name: name || 'Untitled plugin',
			env: parseEnv(),
			modes: buildModes(),
			typeConfig: recipe?.typeConfig ?? {},
			sourceUrl: sourceUrl || recipe?.sourceUrl,
		};
	};

	const writeBackRelativeDockerfile = async (built: Recipe): Promise<void> => {
		const docker = dockerOf(built);
		if (!docker?.dockerfile || !isRelative(docker.dockerfileUrl)) return;

		const path = rel(docker.dockerfileUrl);
		if (isLocalDir(built.sourceUrl)) {
			try {
				await writeTextFile(
					await join(built.sourceUrl!, path),
					docker.dockerfile,
				);
				return;
			} catch (error) {
				console.warn('[RecipeForm] Source directory not writable:', error);
			}
		}

		try {
			const target = `${recipeDirName(built.id)}/${path}`;
			const slash = target.lastIndexOf('/');
			if (slash !== -1) {
				await mkdir(target.slice(0, slash), {
					baseDir: BaseDirectory.AppData,
					recursive: true,
				});
			}
			await writeTextFile(target, docker.dockerfile, {
				baseDir: BaseDirectory.AppData,
			});
		} catch (error) {
			console.warn('[RecipeForm] Could not write Dockerfile back:', error);
		}
	};

	const updateSelectedPart = (content: string) => {
		setParts((prev) =>
			prev.map((p) => (p.name === selectedPart ? { ...p, content } : p)),
		);
	};

	const handleSave = async () => {
		setError(null);
		try {
			if (mode === 'import') {
				await importRecipe(type, importText);
			} else {
				const built = buildRecipe();
				await save(built);
				await writeBackRelativeDockerfile(built);
			}
			onDone();
		} catch (e) {
			setError(e instanceof Error ? e.message : t('Could not save plugin'));
		}
	};

	const handleLoadFromDisk = async () => {
		setError(null);
		try {
			const dir = await openDialog({ directory: true });
			if (typeof dir !== 'string') return;

			let recipeJson: string | null = null;
			let dockerfileText: string | null = null;
			const others: string[] = [];

			const walk = async (base: string, prefix: string): Promise<void> => {
				for (const entry of await readDir(base)) {
					const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
					const abs = await join(base, entry.name);
					if (entry.isDirectory) await walk(abs, relPath);
					else if (relPath === 'recipe.json') recipeJson = await readTextFile(abs);
					else if (relPath.toLowerCase() === 'dockerfile')
						dockerfileText = await readTextFile(abs);
					else if (entry.isFile) others.push(relPath);
				}
			};
			await walk(dir, '');

			if (!recipeJson) throw new Error(t('The selected directory has no recipe.json'));

			const parsed = JSON.parse(recipeJson) as Recipe;
			parsed.id = parsed.id || recipe?.id || '';
			parsed.sourceUrl = dir;

			const docker = dockerOf(parsed);
			console.log('[load] dockerfileUrl =', docker?.dockerfileUrl,
				'| isRelative =', isRelative(docker?.dockerfileUrl));
			if (docker) {
				if (isRelative(docker.dockerfileUrl)) {
					const p = await join(dir, rel(docker.dockerfileUrl));
					docker.dockerfile = await readTextFile(p);
				} else if (!docker.dockerfile && dockerfileText) {
					docker.dockerfile = dockerfileText;
				}
			}
			if (!parsed.icon && isRelative(parsed.iconUrl)) {
				parsed.icon = await inlineIconFromDir(dir, rel(parsed.iconUrl));
			}

			const reserved = new Set(
				[docker?.dockerfileUrl, parsed.iconUrl].filter(isRelative).map(rel),
			);
			const extras = others.filter((r) => !reserved.has(r));
			parsed.extraFiles = extras.length > 0 ? extras : undefined;

			if (parsed.type) setType(parsed.type);
			setSourceUrl(dir);
			setParts(recipeToParts(parsed));
			setSelectedPart('recipe.json');
			setMode('files');
			const built = recipeToParts(parsed);
			setParts(built);
		} catch (e) {
			setError(e instanceof Error ? e.message : t('Could not load recipe'));
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

			const { icon: _icon, sourceUrl: _s, ...rest } = built;
			const docker = dockerOf(built);
			await writeTextFile(
				await join(dir, 'recipe.json'),
				JSON.stringify(
					{
						...rest,
						modes: rest.modes.map((m) =>
							m.kind === 'docker' ? { ...m, dockerfile: docker?.dockerfile } : m,
						),
					},
					null,
					2,
				),
			);
			if (docker?.dockerfile) {
				const target = isRelative(docker.dockerfileUrl) ? rel(docker.dockerfileUrl) : 'Dockerfile';
				const slash = target.lastIndexOf('/');
				if (slash !== -1) {
					try {
						await mkdir(await join(dir, target.slice(0, slash)), { recursive: true });
					} catch (e) {
						throw new Error(`mkdir failed: ${e instanceof Error ? e.message : String(e)}`);
					}
				}
				await writeTextFile(await join(dir, target), docker.dockerfile);
			}
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

	return (
		<div className='recipe-form'>
			<div className='recipe-form-header'>
				<h3>{recipe ? t('Edit plugin') : t('Add plugin')}</h3>
				<div className='view-tabs'>
					{modeTab('guided', t('Guided'))}
					{modeTab('files', t('Files'))}
					{modeTab('import', t('Paste config'))}
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
						placeholder={t('Paste a TeXlyre LSP recipe (typeConfig) block or recipe JSON')}
					/>
				</div>
			) : mode === 'files' ? (
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
								// eslint-disable-next-line react/no-danger
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
						<small>{t('Each step runs in order. Review commands before installing.')}</small>
					</div>
					<div className='form-group'>
						<label>{t('Uninstall steps')}</label>
						<textarea
							rows={3}
							spellCheck={false}
							value={uninstallText}
							onChange={(e) => setUninstallText(e.target.value)}
							placeholder={t('One per line: Label :: command arg1 arg2')}
						/>
					</div>
					<div className='form-group'>
						<label>{t('Docker image')}</label>
						<input
							value={dockerImage}
							onChange={(e) => setDockerImage(e.target.value)}
							placeholder='traefik:3.7.8'
						/>
						<small>{t('Container image used in Docker mode. Leave empty to remove Docker mode.')}</small>
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
						<small>{t('One per line as KEY=value. Passed to install and run commands.')}</small>
					</div>
				</>
			)}

			<div className='form-actions'>
				<button className='button' onClick={handleLoadFromDisk}>
					{t('Load directory')}
				</button>
				{mode !== 'import' && (
					<button className='button' onClick={handleSaveToDisk}>
						{t('Save to directory')}
					</button>
				)}
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
