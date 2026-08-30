// src/plugin-host/recipeWorkdir.ts
import { appDataDir, join } from '@tauri-apps/api/path';
import {
	BaseDirectory,
	mkdir,
	writeFile,
	writeTextFile,
} from '@tauri-apps/plugin-fs';

import { fetchRecipeFileBytes, normalizeRecipeFilePath } from './recipeFiles';
import { findMode, type DockerMode, type Recipe } from './types';

const safeName = (id: string): string => id.replace(/[^a-zA-Z0-9_.-]/g, '-');

export const recipeDirName = (id: string): string => `recipes/${safeName(id)}`;

const ensureParent = async (relative: string, path: string): Promise<void> => {
	const slash = path.lastIndexOf('/');
	if (slash === -1) return;
	await mkdir(`${relative}/${path.slice(0, slash)}`, {
		baseDir: BaseDirectory.AppData,
		recursive: true,
	});
};

export async function materializeRecipeFiles(
	recipe: Recipe,
): Promise<string | null> {
	const docker = findMode(recipe, 'docker') as DockerMode | undefined;
	const dockerfile = docker?.dockerfile;
	const extras = recipe.extraFiles ?? [];

	if (!dockerfile && extras.length === 0) return null;

	const relative = recipeDirName(recipe.id);
	await mkdir(relative, { baseDir: BaseDirectory.AppData, recursive: true });

	if (dockerfile) {
		await writeTextFile(`${relative}/Dockerfile.chelys`, dockerfile, {
			baseDir: BaseDirectory.AppData,
		});
	}

	if (extras.length > 0) {
		if (!recipe.sourceUrl) {
			throw new Error(
				'Recipe has extra files but no source to fetch them from',
			);
		}

		for (const rawPath of extras) {
			const path = normalizeRecipeFilePath(rawPath);
			const bytes = await fetchRecipeFileBytes(recipe.sourceUrl, path);
			await ensureParent(relative, path);
			await writeFile(`${relative}/${path}`, bytes, {
				baseDir: BaseDirectory.AppData,
			});
		}
	}

	return join(await appDataDir(), relative);
}
