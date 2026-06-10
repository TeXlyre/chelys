// src/plugin-host/platformResolution.ts
import type { PlatformId, Recipe, SystemMode } from './types';

let cached: PlatformId | null = null;

export async function detectPlatform(): Promise<PlatformId> {
    if (cached) return cached;
    try {
        const { platform } = await import('@tauri-apps/plugin-os');
        cached = platform();
    } catch {
        cached = 'desktop';
    }
    return cached;
}

export function applyPlatform(recipe: Recipe, platform: PlatformId): Recipe {
    const modes = recipe.modes.map((mode) => {
        if (mode.kind !== 'system') return mode;
        const system = mode as SystemMode;
        const override = system.platforms?.[platform];
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