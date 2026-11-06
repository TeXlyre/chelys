// src/plugins/storage/injection.ts
import { injectConfigBlock, removeConfigBlock } from '../../plugin-host/configInjection';
import type { Recipe } from '../../plugin-host/types';
import { recipeToConfigBlock } from './shared';
import type { StorageTypeConfig } from './types';

const SETTING_KEY = 'generic-storage-configs';

export function injectStorageConfig(recipe: Recipe): void {
	injectConfigBlock(SETTING_KEY, recipeToConfigBlock(recipe, true));
}

export function removeStorageConfig(recipe: Recipe): void {
	removeConfigBlock(
		SETTING_KEY,
		(recipe.typeConfig as unknown as StorageTypeConfig).configId,
	);
}
