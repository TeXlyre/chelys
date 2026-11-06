// src/plugins/typesetter/injection.ts
import { injectConfigBlock, removeConfigBlock } from '../../plugin-host/configInjection';
import type { Recipe } from '../../plugin-host/types';
import { recipeToConfigBlock } from './shared';
import type { TypesetterTypeConfig } from './types';

const SETTING_KEY = 'generic-typesetter-configs';

export function injectTypesetterConfig(recipe: Recipe): void {
	injectConfigBlock(SETTING_KEY, recipeToConfigBlock(recipe, true));
}

export function removeTypesetterConfig(recipe: Recipe): void {
	removeConfigBlock(
		SETTING_KEY,
		(recipe.typeConfig as unknown as TypesetterTypeConfig).configId,
	);
}
