// src/plugin-host/platformResolution.ts
import { getStoredSetting } from '../config';
import type { PlatformId, Recipe, SystemMode } from './types';

export type RecipePlatformOverride = 'auto' | 'windows' | 'macos' | 'linux';

export interface PlatformInfo {
	detected: PlatformId;
	effective: PlatformId;
	override: RecipePlatformOverride;
}

export type ArchId = 'amd64' | 'arm64';

let cachedDetectedPlatform: PlatformId | null = null;
let cachedArch: ArchId | null = null;

export function normalizePlatform(platform: string): PlatformId {
	const normalized = platform.trim().toLowerCase();

	if (normalized === 'windows' || normalized === 'win32') {
		return 'windows';
	}

	if (normalized === 'macos' || normalized === 'darwin') {
		return 'macos';
	}

	if (normalized === 'linux') {
		return 'linux';
	}

	return normalized;
}

export function normalizePlatformOverride(
	value: unknown,
): RecipePlatformOverride {
	if (
		value === 'auto' ||
		value === 'windows' ||
		value === 'macos' ||
		value === 'linux'
	) {
		return value;
	}

	return 'auto';
}

export function getDetectedPlatform(): PlatformId | null {
	return cachedDetectedPlatform;
}

export function resetPlatformCache(): void {
	cachedDetectedPlatform = null;
}

export async function detectActualPlatform(): Promise<PlatformId> {
	if (cachedDetectedPlatform) return cachedDetectedPlatform;

	try {
		const { platform } = await import('@tauri-apps/plugin-os');
		cachedDetectedPlatform = normalizePlatform(platform());
	} catch (error) {
		console.warn(
			'[Chelys] OS detection failed, falling back to desktop',
			error,
		);
		cachedDetectedPlatform = 'desktop';
	}

	return cachedDetectedPlatform;
}

export async function detectArch(): Promise<ArchId | null> {
	if (cachedArch) return cachedArch;

	try {
		const { arch } = await import('@tauri-apps/plugin-os');
		const value = arch().toLowerCase();

		cachedArch =
			value === 'x86_64' ? 'amd64' : value === 'aarch64' ? 'arm64' : null;
	} catch (error) {
		console.warn('[Chelys] CPU architecture detection failed', error);
		cachedArch = null;
	}

	return cachedArch;
}

export const dockerPlatform = (arch: ArchId | null): string | null =>
	arch ? `linux/${arch}` : null;

export function getPlatformOverride(): RecipePlatformOverride {
	return normalizePlatformOverride(
		getStoredSetting<RecipePlatformOverride>('recipePlatformOverride'),
	);
}

export async function getPlatformInfo(): Promise<PlatformInfo> {
	const detected = await detectActualPlatform();
	const override = getPlatformOverride();

	return {
		detected,
		override,
		effective: override === 'auto' ? detected : override,
	};
}

export async function detectPlatform(): Promise<PlatformId> {
	const info = await getPlatformInfo();
	return info.effective;
}

export function formatPlatform(
	platform: PlatformId | null | undefined,
): string {
	if (!platform) return 'Detecting OS';

	if (platform === 'windows') return 'Windows';
	if (platform === 'macos') return 'macOS';
	if (platform === 'linux') return 'Linux';
	if (platform === 'desktop') return 'Unknown desktop OS';

	return platform;
}

export function applyPlatform(recipe: Recipe, platform: PlatformId): Recipe {
	const platformKey = normalizePlatform(platform);

	const modes = recipe.modes.map((mode) => {
		if (mode.kind === 'docker') {
			const override = mode.platforms?.[platformKey];

			if (!override) return mode;

			return {
				...mode,
				runArgs: override.runArgs ?? mode.runArgs,
				command: override.command ?? mode.command,
			};
		}

		if (mode.kind !== 'system') return mode;

		const system = mode as SystemMode;
		const override = system.platforms?.[platformKey];

		if (!override) return system;

		return {
			...system,
			installSteps: override.installSteps ?? system.installSteps,
			uninstallSteps: override.uninstallSteps ?? system.uninstallSteps,
			runCommand: override.runCommand ?? system.runCommand,
		};
	});

	return { ...recipe, modes };
}
