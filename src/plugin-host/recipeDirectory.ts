// src/plugin-host/recipeDirectory.ts
import { join } from '@tauri-apps/api/path';
import {
	BaseDirectory,
	mkdir,
	readDir,
	readFile,
	readTextFile,
	writeFile,
	writeTextFile,
} from '@tauri-apps/plugin-fs';

import {
	fetchRecipeFileBytes,
	isRecipeUrl,
	normalizeRecipeFilePath,
} from './recipeFiles';
import { recipeDirName } from './recipeWorkdir';
import { findMode, type DockerMode, type Recipe } from './types';

export type RecipeTextFiles = Record<string, string>;

export const isUrl = isRecipeUrl;

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

	const mime = /\.jpe?g$/i.test(path)
		? 'image/jpeg'
		: /\.webp$/i.test(path)
			? 'image/webp'
			: /\.gif$/i.test(path)
				? 'image/gif'
				: 'image/png';
	return `<img src="data:${mime};base64,${btoa(binary)}" alt="" />`;
};

const parentDir = async (dir: string, path: string): Promise<void> => {
	const slash = path.lastIndexOf('/');
	if (slash === -1) return;
	await mkdir(await join(dir, path.slice(0, slash)), { recursive: true });
};

const bytesFromBase64 = (base64: string): Uint8Array => {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
};

const iconNameFromUrl = (
	iconUrl: string | undefined,
	fallback: string,
): string => {
	if (!iconUrl) return fallback;
	const withoutQuery = iconUrl.split(/[?#]/, 1)[0];
	const name = withoutQuery.split(/[\\/]/).pop();
	return name && /^[a-zA-Z0-9_.-]+$/.test(name) ? name : fallback;
};

async function writeInlineIconToDirectory(
	recipe: Recipe,
	dir: string,
): Promise<string | undefined> {
	const icon = recipe.icon?.trim();
	if (!icon) return undefined;

	if (/<svg(?:\s|>)/i.test(icon)) {
		const name = iconNameFromUrl(recipe.iconUrl, 'icon.svg');
		const target = /\.svg$/i.test(name) ? name : 'icon.svg';
		await writeTextFile(await join(dir, target), icon);
		return target;
	}

	const data = icon.match(/src=["']data:([^;,]+);base64,([^"']+)["']/i);
	if (!data) return undefined;

	const mime = data[1].toLowerCase();
	const extension =
		mime === 'image/svg+xml'
			? 'svg'
			: mime === 'image/jpeg'
				? 'jpg'
				: mime === 'image/webp'
					? 'webp'
					: mime === 'image/gif'
						? 'gif'
						: 'png';
	const name = iconNameFromUrl(recipe.iconUrl, `icon.${extension}`);
	const expectedExtension =
		extension === 'jpg' ? /\.jpe?g$/i : new RegExp(`\\.${extension}$`, 'i');
	const target = expectedExtension.test(name) ? name : `icon.${extension}`;
	await writeFile(await join(dir, target), bytesFromBase64(data[2]));
	return target;
}

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
	extraTextFiles: RecipeTextFiles = {},
): Promise<void> {
	const { icon: _icon, sourceUrl: _sourceUrl, ...rest } = recipe;
	const docker = dockerOf(recipe);
	const exportedIconUrl = await writeInlineIconToDirectory(recipe, dir);

	await writeTextFile(
		await join(dir, 'recipe.json'),
		JSON.stringify(
			{
				...rest,
				...(exportedIconUrl ? { iconUrl: exportedIconUrl } : {}),
				modes: rest.modes.map((m) =>
					m.kind === 'docker' ? { ...m, dockerfile: docker?.dockerfile } : m,
				),
			},
			null,
			2,
		),
	);

	if (docker?.dockerfile) {
		const target = isRelative(docker.dockerfileUrl)
			? rel(docker.dockerfileUrl)
			: 'Dockerfile';
		await parentDir(dir, target);
		await writeTextFile(await join(dir, target), docker.dockerfile);
	}

	const extras = recipe.extraFiles ?? [];
	if (extras.length === 0) return;
	if (!recipe.sourceUrl) {
		throw new Error('Recipe has extra files but no source to fetch them from');
	}

	for (const rawPath of extras) {
		const path = normalizeRecipeFilePath(rawPath);
		await parentDir(dir, path);

		const text = extraTextFiles[path] ?? extraTextFiles[rawPath];
		if (text !== undefined) {
			await writeTextFile(await join(dir, path), text);
			continue;
		}

		const bytes = await fetchRecipeFileBytes(recipe.sourceUrl, path);
		await writeFile(await join(dir, path), bytes);
	}
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

export async function writeBackExtraFiles(
	recipe: Recipe,
	files: RecipeTextFiles,
): Promise<void> {
	if (!isLocalDir(recipe.sourceUrl)) return;

	for (const [rawPath, content] of Object.entries(files)) {
		const path = normalizeRecipeFilePath(rawPath);
		try {
			await parentDir(recipe.sourceUrl as string, path);
			await writeTextFile(
				await join(recipe.sourceUrl as string, path),
				content,
			);
		} catch (error) {
			console.warn(`[recipeDirectory] Could not write ${path} back:`, error);
		}
	}
}
