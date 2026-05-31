// src/utils/systemSettings.ts
import { invoke } from '@tauri-apps/api/core';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

export const applyCloseBehavior = (exitOnClose: boolean): void => {
    void invoke('set_close_behavior', { exitOnClose });
};

export const applyStartOnBoot = async (enabled: boolean): Promise<void> => {
    const current = await isEnabled();
    if (enabled && !current) await enable();
    else if (!enabled && current) await disable();
};