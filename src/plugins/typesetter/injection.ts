// src/plugins/typesetter/injection.ts
import { getUserData, setUserData } from '@texlyre/utils/userDataUtils';
import { getActiveAccountId } from '../../plugin-host/activeAccount';
import type { Recipe } from '../../plugin-host/types';
import { recipeToConfigBlock } from './shared';
import type { TypesetterConfigBlock, TypesetterTypeConfig } from './types';

const SETTING_KEY = 'generic-typesetter-configs';

const readSettings = (userId: string): Record<string, unknown> => {
	try {
		return getUserData<Record<string, unknown>>(userId, 'settings') ?? {};
	} catch {
		return {};
	}
};

const readBlocks = (
	settings: Record<string, unknown>,
): TypesetterConfigBlock[] => {
	const value = settings[SETTING_KEY];

	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	return Array.isArray(value) ? (value as TypesetterConfigBlock[]) : [];
};

const writeBlocks = (
	userId: string,
	settings: Record<string, unknown>,
	blocks: TypesetterConfigBlock[],
): void => {
	const nextSettings = {
		...settings,
		[SETTING_KEY]: JSON.stringify(blocks),
	};

	setUserData(userId, 'settings', nextSettings);
};

export function injectTypesetterConfig(recipe: Recipe): void {
	const userId = getActiveAccountId();
	if (!userId) return;

	const settings = readSettings(userId);
	const blocks = readBlocks(settings);
	const block = recipeToConfigBlock(recipe, true);

	const next = blocks.filter((b) => b.id !== block.id);
	next.push(block);

	writeBlocks(userId, settings, next);
}

export function removeTypesetterConfig(recipe: Recipe): void {
	const userId = getActiveAccountId();
	if (!userId) return;

	const settings = readSettings(userId);
	const blocks = readBlocks(settings);
	const configId = (recipe.typeConfig as unknown as TypesetterTypeConfig)
		.configId;

	const next = blocks.filter((b) => b.id !== configId);
	if (next.length === blocks.length) return;

	writeBlocks(userId, settings, next);
}
