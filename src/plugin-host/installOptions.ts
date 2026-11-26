import { modeLabel, type DockerInstallSource, type InstallModeKind, type Recipe, type RecipeRuntimeState } from './types';
import { canPullImage } from './variableResolution';

export interface InstallOption {
	id: string;
	mode: InstallModeKind;
	source?: DockerInstallSource;
	label: string;
}

/** The same choices for individual and bulk installation. */
export function recipeInstallOptions(recipe: Recipe): InstallOption[] {
	if (recipe.type === 'service') return [{ id: 'connect', mode: 'connect', label: 'Install member plugins' }];
	return recipe.modes.flatMap((mode): InstallOption[] => {
		if (mode.kind !== 'docker') {
			return [{ id: mode.kind, mode: mode.kind, label: modeLabel(mode.kind) }];
		}
		const hasDockerfile = !!(mode.dockerfile || mode.dockerfileUrl);
		const options: InstallOption[] = [{
			id: hasDockerfile ? 'docker-build' : 'docker-registry',
			mode: 'docker',
			source: 'build',
			label: hasDockerfile ? 'Container – build image locally' : 'Container – pull image',
		}];
		if (canPullImage(mode)) {
			options.push({ id: 'docker-registry', mode: 'docker', source: 'registry', label: 'Container – pull image' });
		}
		return options;
	});
}

export function canBulkInstall(recipe: Recipe, state: RecipeRuntimeState): boolean {
	return state === 'not-installed' && recipeInstallOptions(recipe).length > 0;
}

/** Count each supported method once per recipe; retain its actual install source. */
export function bulkInstallOptions(recipes: Recipe[]) {
	const groups = new Map<string, { id: string; label: string; targets: { recipe: Recipe; option: InstallOption }[] }>();
	for (const recipe of recipes) {
		for (const option of recipeInstallOptions(recipe)) {
			let group = groups.get(option.id);
			if (!group) {
				group = { id: option.id, label: option.label, targets: [] };
				groups.set(option.id, group);
			}
			if (!group.targets.some((target) => target.recipe.id === recipe.id)) group.targets.push({ recipe, option });
		}
	}
	return ['docker-build', 'docker-registry', 'system', 'connect'].flatMap((id) => {
		const group = groups.get(id);
		return group ? [group] : [];
	});
}
