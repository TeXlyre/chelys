// src/plugins/lsp/injection.ts
import {
	injectConfigBlock,
	removeConfigBlock,
} from '../../plugin-host/configInjection';
import type { Recipe } from '../../plugin-host/types';
import { recipeToConfigBlock } from './shared';
import type { LspTypeConfig } from './types';

const SETTING_KEY = 'generic-lsp-configs';

export function injectLspConfig(recipe: Recipe): void {
	injectConfigBlock(SETTING_KEY, recipeToConfigBlock(recipe, true));
}

export function removeLspConfig(recipe: Recipe): void {
	removeConfigBlock(
		SETTING_KEY,
		(recipe.typeConfig as unknown as LspTypeConfig).configId,
	);
}
