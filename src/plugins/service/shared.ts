// src/plugins/service/shared.ts
import type { Recipe } from '../../plugin-host/types';

export const SERVICE_TYPE = 'service';
export const SERVICE_PREFIX = 'service-group-config:';
export const ENDPOINT_PREFIX = 'generic-plugin-config:';
export const instanceRecipeId = (instance: string, recipe: string) =>
	`${instance}.${recipe}`;

export interface ServiceMember {
	recipeId: string;
	instanceId?: string;
}
const recipeIdPattern = /^[A-Za-z0-9_.-]{1,128}$/;
const instancePattern =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Local IDs or an explicit same-account machine UUID/recipe ID. No nesting. */
export function serviceMembers(recipe: Recipe): ServiceMember[] {
	const raw = recipe.typeConfig.members;
	if (!Array.isArray(raw) || !raw.length || raw.length > 100)
		throw Error('A service requires 1–100 plugin references');
	const seen = new Set<string>();
	return raw.map((value) => {
		if (typeof value !== 'string')
			throw Error('Plugin references must be strings');
		const parts = value.split('/');
		const recipeId = parts[parts.length - 1];
		const instanceId = parts.length === 2 ? parts[0].toLowerCase() : undefined;
		if (
			parts.length > 2 ||
			!recipeIdPattern.test(recipeId) ||
			(instanceId !== undefined && !instancePattern.test(instanceId)) ||
			(!instanceId && recipeId === recipe.id) ||
			seen.has(`${instanceId ?? ''}/${recipeId}`)
		)
			throw Error(`Invalid or duplicate member: ${value}`);
		seen.add(`${instanceId ?? ''}/${recipeId}`);
		return { recipeId, ...(instanceId ? { instanceId } : {}) };
	});
}
export function validateService(recipe: Recipe): void {
	serviceMembers(recipe);
	if (
		recipe.modes.length !== 1 ||
		recipe.modes[0].kind !== 'connect' ||
		Object.keys(recipe.env).length ||
		recipe.extraFiles?.length ||
		recipe.variables?.length ||
		recipe.cwd
	)
		throw Error(
			'Services are process-free groups; use only connect mode and plugin references',
		);
}
