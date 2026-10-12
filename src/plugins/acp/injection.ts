// src/plugins/acp/injection.ts
import { getUserData, setUserData } from '@texlyre/utils/userDataUtils';
import { getActiveAccountId } from '../../plugin-host/activeAccount';
import type { Recipe } from '../../plugin-host/types';
import { recipeToConfigBlock } from './shared';
import type { AcpConfigBlock, AcpTypeConfig } from './types';

const SETTING_KEY = 'generic-acp-configs';

const readSettings = (userId: string): Record<string, unknown> => {
	try {
		return getUserData<Record<string, unknown>>(userId, 'settings') ?? {};
	} catch {
		return {};
	}
};

const readBlocks = (settings: Record<string, unknown>): AcpConfigBlock[] => {
	const value = settings[SETTING_KEY];

	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	return Array.isArray(value) ? (value as AcpConfigBlock[]) : [];
};

const writeBlocks = (
	userId: string,
	settings: Record<string, unknown>,
	blocks: AcpConfigBlock[],
): void => {
	const nextSettings = {
		...settings,
		[SETTING_KEY]: JSON.stringify(blocks),
	};

	setUserData(userId, 'settings', nextSettings);
};

export function injectAcpConfig(recipe: Recipe): void {
	const userId = getActiveAccountId();
	if (!userId) return;

	const settings = readSettings(userId);
	const blocks = readBlocks(settings);
	const block = recipeToConfigBlock(recipe, true);

	const next = blocks.filter((b) => b.id !== block.id);
	next.push(block);

	writeBlocks(userId, settings, next);
}

export function removeAcpConfig(recipe: Recipe): void {
	const userId = getActiveAccountId();
	if (!userId) return;

	const settings = readSettings(userId);
	const blocks = readBlocks(settings);
	const configId = (recipe.typeConfig as unknown as AcpTypeConfig).configId;

	const next = blocks.filter((b) => b.id !== configId);
	if (next.length === blocks.length) return;

	writeBlocks(userId, settings, next);
}
