// src/plugin-host/recipeStateLabels.ts
import type { RecipeRuntimeState } from './types';

export const recipeStateLabels: Record<RecipeRuntimeState, string> = {
	'not-installed': 'Not installed',
	installing: 'Installing…',
	installed: 'Installed',
	starting: 'Starting…',
	running: 'Running',
	stopping: 'Stopping…',
	stopped: 'Stopped',
	error: 'Error',
};
