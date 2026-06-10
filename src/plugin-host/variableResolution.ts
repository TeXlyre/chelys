// src/plugin-host/variableResolution.ts
import type {
    CommandSpec,
    DockerMode,
    InstallStep,
    Recipe,
} from './types';

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
    if (typeof value === 'string') return substitute(value, values) as unknown as T;
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

const dockerfileStep = (content: string): InstallStep => ({
    label: 'Write Dockerfile',
    command: 'sh',
    args: ['-c', `printf %s "$0" > ${DOCKERFILE_NAME}`, content],
});

export function resolveRecipe(recipe: Recipe): Recipe {
    const values = effectiveValues(recipe);
    const resolved = mapStrings(recipe, values) as Recipe;

    for (const mode of resolved.modes) {
        if (mode.kind !== 'docker') continue;
        const docker = mode as DockerMode;
        if (!docker.dockerfile) continue;
        docker.buildSteps = [
            ...docker.buildSteps,
            dockerfileStep(docker.dockerfile),
            {
                label: 'Build image',
                command: 'docker',
                args: ['build', '-f', DOCKERFILE_NAME, '-t', docker.image, '.'],
            },
        ];
    }
    return resolved;
}

export const resolveCommand = (
    spec: CommandSpec,
    values: Record<string, string>,
): CommandSpec => mapStrings(spec, values);