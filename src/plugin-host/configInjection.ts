// src/plugin-host/configInjection.ts
import { getUserData, setUserData } from '@texlyre/utils/userDataUtils';
import { getActiveAccountId } from './activeAccount';

interface ConfigBlock {
	id: string;
}

const readSettings = (userId: string): Record<string, unknown> => {
	try {
		return getUserData<Record<string, unknown>>(userId, 'settings') ?? {};
	} catch {
		return {};
	}
};

const readBlocks = <T extends ConfigBlock>(
	settings: Record<string, unknown>,
	settingKey: string,
): T[] => {
	const value = settings[settingKey];
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return Array.isArray(value) ? (value as T[]) : [];
};

const writeBlocks = <T extends ConfigBlock>(
	userId: string,
	settings: Record<string, unknown>,
	settingKey: string,
	blocks: T[],
): void => {
	setUserData(userId, 'settings', {
		...settings,
		[settingKey]: JSON.stringify(blocks),
	});
};

export function injectConfigBlock<T extends ConfigBlock>(
	settingKey: string,
	block: T,
): void {
	const userId = getActiveAccountId();
	if (!userId) return;

	const settings = readSettings(userId);
	const next = readBlocks<T>(settings, settingKey).filter(
		(candidate) => candidate.id !== block.id,
	);
	next.push(block);
	writeBlocks(userId, settings, settingKey, next);
}

export function removeConfigBlock(settingKey: string, configId: string): void {
	const userId = getActiveAccountId();
	if (!userId) return;

	const settings = readSettings(userId);
	const blocks = readBlocks(settings, settingKey);
	const next = blocks.filter((block) => block.id !== configId);
	if (next.length !== blocks.length) {
		writeBlocks(userId, settings, settingKey, next);
	}
}
