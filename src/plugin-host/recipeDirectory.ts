// src/plugin-host/recipeDirectory.ts
import { join } from '@tauri-apps/api/path';
import {
	BaseDirectory,
	mkdir,
	readDir,
	readFile,
	readTextFile,
	writeTextFile,
} from '@tauri-apps/plugin-fs';

import { recipeDirName } from './recipeWorkdir';
import { findMode, type DockerMode, type Recipe } from './types';

export const isUrl = (value?: string): boolean =>
	!!value && /^https?:\/\//i.test(value);

export const isRelative = (value?: string): value is string =>
	!!value && !isUrl(value);

export const rel = (path: string): string => path.replace(/^\.\//, '');

export const isLocalDir = (source?: string): boolean =>
	!!source && !isUrl(source);

export const dockerOf = (recipe: Recipe): DockerMode | undefined =>
	findMode(recipe, 'docker') as DockerMode | undefined;

const inlineIconFromDir = async (
	dir: string,
	path: string,
): Promise<string> => {
	if (/\.svg$/i.test(path)) return readTextFile(await join(dir, path));

	const bytes = await readFile(await join(dir, path));
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);

	return `<img src="data:image/png;base64,${btoa(binary)}" alt="" />`;
};

export async function loadRecipeFromDirectory(
	dir: string,
	fallbackId = '',
): Promise<Recipe> {
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

	if (!recipeJson) throw new Error('The selected directory has no recipe.json');

	const parsed = JSON.parse(recipeJson) as Recipe;
	parsed.id = parsed.id || fallbackId;
	parsed.sourceUrl = dir;

	const docker = dockerOf(parsed);
	if (docker) {
		if (isRelative(docker.dockerfileUrl)) {
			docker.dockerfile = await readTextFile(
				await join(dir, rel(docker.dockerfileUrl)),
			);
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
	const extras = others.filter((path) => !reserved.has(path));
	parsed.extraFiles = extras.length > 0 ? extras : undefined;

	return parsed;
}

export async function writeRecipeToDirectory(
	recipe: Recipe,
	dir: string,
): Promise<void> {
	const { icon: _icon, sourceUrl: _sourceUrl, ...rest } = recipe;
	const docker = dockerOf(recipe);

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

	if (!docker?.dockerfile) return;

	const target = isRelative(docker.dockerfileUrl)
		? rel(docker.dockerfileUrl)
		: 'Dockerfile';
	const slash = target.lastIndexOf('/');

	if (slash !== -1) {
		await mkdir(await join(dir, target.slice(0, slash)), { recursive: true });
	}

	await writeTextFile(await join(dir, target), docker.dockerfile);
}

export async function writeBackRelativeDockerfile(
	recipe: Recipe,
): Promise<void> {
	const docker = dockerOf(recipe);
	if (!docker?.dockerfile || !isRelative(docker.dockerfileUrl)) return;

	const path = rel(docker.dockerfileUrl);

	if (isLocalDir(recipe.sourceUrl)) {
		try {
			await writeTextFile(
				await join(recipe.sourceUrl as string, path),
				docker.dockerfile,
			);
			return;
		} catch (error) {
			console.warn('[recipeDirectory] Source directory not writable:', error);
		}
	}

	try {
		const target = `${recipeDirName(recipe.id)}/${path}`;
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
		console.warn('[recipeDirectory] Could not write Dockerfile back:', error);
	}
}
