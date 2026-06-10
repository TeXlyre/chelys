// src/plugin-host/RecipeStore.ts
import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';

import type { Recipe } from './types';

const FILE_NAME = 'chelys-recipes.json';

class RecipeStore {
	private pathPromise: Promise<string> | null = null;

	private async filePath(): Promise<string> {
		if (!this.pathPromise) {
			this.pathPromise = (async () => {
				const dir = await appDataDir();
				return invoke<string>('path_join', { parts: [dir, FILE_NAME] });
			})();
		}
		return this.pathPromise;
	}

	async load(): Promise<Recipe[]> {
		const path = await this.filePath();
		if (!(await invoke<boolean>('fs_exists', { path }))) return [];
		try {
			const bytes = await invoke<number[]>('fs_read', { path });
			const text = new TextDecoder().decode(Uint8Array.from(bytes));
			const parsed = JSON.parse(text);
			return Array.isArray(parsed) ? parsed : [];
		} catch (error) {
			console.error('[RecipeStore] Failed to read recipes:', error);
			return [];
		}
	}

	async save(recipes: Recipe[]): Promise<void> {
		const path = await this.filePath();
		const text = JSON.stringify(recipes, null, 2);
		const contents = Array.from(new TextEncoder().encode(text));
		await invoke('fs_write', { path, contents });
	}
}

export const recipeStore = new RecipeStore();
