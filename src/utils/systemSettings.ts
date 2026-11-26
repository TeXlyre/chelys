// src/utils/systemSettings.ts
import { invoke } from '@tauri-apps/api/core';

export const applyCloseBehavior = (exitOnClose: boolean): void => {
	void invoke('set_close_behavior', { exitOnClose });
};
