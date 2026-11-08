// src/plugins/acp/injection.ts
import { injectConfigBlock, removeConfigBlock } from '../../plugin-host/configInjection';
import type { Recipe } from '../../plugin-host/types';
import { recipeToConfigBlock } from './shared';
import type { AcpTypeConfig } from './types';

const SETTING_KEY = 'generic-acp-configs';

export function injectAcpConfig(recipe: Recipe): void {
	injectConfigBlock(SETTING_KEY, recipeToConfigBlock(recipe, true));
}

export function removeAcpConfig(recipe: Recipe): void {
	removeConfigBlock(
		SETTING_KEY,
		(recipe.typeConfig as unknown as AcpTypeConfig).configId,
	);
}
