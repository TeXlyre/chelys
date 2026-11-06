// src/plugin-host/variableResolution.ts
import { rewriteTransportUrl } from './traefikRouting';
import type { CommandSpec, DockerMode, InstallStep, Recipe } from './types';

const DOCKERFILE_NAME = 'Dockerfile.chelys';

export function effectiveValues(recipe: Recipe): Record<string, string> {
	const values: Record<string, string> = {};

	for (const variable of recipe.variables ?? []) {
		values[variable.key] = variable.default ?? '';
	}

	return { ...values, ...(recipe.variableValues ?? {}) };
}

const substitute = (input: string, values: Record<string, string>): string =>
	input.replace(/\$\{(\w+)\}/g, (match, key) =>
		key in values ? values[key] : match,
	);

const mapStrings = <T>(value: T, values: Record<string, string>): T => {
	if (typeof value === 'string') {
		return substitute(value, values) as unknown as T;
	}

	if (Array.isArray(value)) {
		return value.map((item) => mapStrings(item, values)) as unknown as T;
	}

	if (value && typeof value === 'object') {
		const result: Record<string, unknown> = {};

		for (const [key, inner] of Object.entries(value)) {
			result[key] = mapStrings(inner, values);
		}

		return result as T;
	}

	return value;
};

export const secretKeys = (recipe: Recipe): Set<string> =>
	new Set(
		(recipe.variables ?? [])
			.filter((variable) => variable.kind === 'secret')
			.map((variable) => variable.key),
	);

// The recipe without the values of its secret variables, e.g. for download.
export function withoutSecretValues(recipe: Recipe): Recipe {
	const secrets = secretKeys(recipe);
	if (secrets.size === 0 || !recipe.variableValues) return recipe;
	return {
		...recipe,
		variableValues: Object.fromEntries(
			Object.entries(recipe.variableValues).filter(
				([key]) => !secrets.has(key),
			),
		),
	};
}

const SINGLE_TOKEN = /^\$\{(\w+)\}$/;

const resolveEnv = (
	env: Record<string, string>,
	values: Record<string, string>,
	secrets: Set<string>,
): Record<string, string> => {
	const resolved: Record<string, string> = {};
	for (const [key, template] of Object.entries(env)) {
		const token = template.match(SINGLE_TOKEN)?.[1];
		// An empty secret leaves the inherited variable in place.
		if (token && secrets.has(token) && !values[token]) continue;
		resolved[key] = substitute(template, values);
	}
	return resolved;
};

const dockerfileDownloadStep = (dockerfileUrl: string) => ({
	label: 'Download Dockerfile',
	command: 'curl',
	args: ['-fL', '-o', DOCKERFILE_NAME, dockerfileUrl],
});

const dockerBuildStep = (docker: DockerMode) => ({
	label: 'Build image',
	command: 'docker',
	args: ['build', '-f', DOCKERFILE_NAME, '-t', docker.image, '.'],
});

const dockerPullStep = (docker: DockerMode) => ({
	label: 'Pull image',
	command: 'docker',
	args: ['pull', docker.image],
});

const REGISTRY_REF = /^[^/]*[.:][^/]*\//;

export const canPullImage = (docker: DockerMode): boolean =>
	(!!docker.dockerfile || !!docker.dockerfileUrl) &&
	REGISTRY_REF.test(docker.image);

export const registryPullSteps = (
	docker: DockerMode,
	platform: string | null,
): InstallStep[] => [
	{
		label: 'Pull image',
		command: 'docker',
		args: ['pull', ...(platform ? ['--platform', platform] : []), docker.image],
	},
];

export function resolveRecipe(recipe: Recipe): Recipe {
	const values = effectiveValues(recipe);
	const secrets = secretKeys(recipe);
	// Secrets go into env only: never into commands (logged, and visible to
	// other processes) or the config block handed to TeXlyre.
	const publicValues = Object.fromEntries(
		Object.entries(values).filter(([key]) => !secrets.has(key)),
	);
	const resolved = mapStrings(recipe, publicValues) as Recipe;
	resolved.env = resolveEnv(recipe.env ?? {}, values, secrets);

	for (const mode of resolved.modes) {
		if (mode.kind !== 'docker') continue;

		const docker = mode as DockerMode;
		const hasDockerfile = !!docker.dockerfileUrl || !!docker.dockerfile;

		docker.buildSteps = [
			...docker.buildSteps,
			...(docker.dockerfileUrl && /^https?:\/\//i.test(docker.dockerfileUrl)
				? [dockerfileDownloadStep(docker.dockerfileUrl)]
				: []),
			...(hasDockerfile ? [dockerBuildStep(docker)] : [dockerPullStep(docker)]),
		];
	}

	const rewritten = rewriteTransportUrl(
		resolved.typeConfig as { transportUrl?: unknown; configId?: unknown },
	);
	if (rewritten !== undefined) {
		resolved.typeConfig = { ...resolved.typeConfig, transportUrl: rewritten };
	}

	return resolved;
}

export const resolveCommand = (
	spec: CommandSpec,
	values: Record<string, string>,
): CommandSpec => mapStrings(spec, values);
