// src/plugin-host/dockerVolumes.ts
import type { DockerVolume } from './types';

const safeVolumePart = (value: string): string =>
	value.replace(/[^a-zA-Z0-9_.-]/g, '-');

export const dockerVolumeName = (
	recipeId: string,
	volumeId: string,
	name?: string,
): string => {
	if (name) {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
			throw new Error(`Invalid container volume name: ${name}`);
		}
		return name;
	}
	return `chelys-${safeVolumePart(recipeId)}-${safeVolumePart(volumeId)}`;
};

export const dockerVolumeArgs = (
	recipeId: string,
	volumes: DockerVolume[] | undefined,
): string[] =>
	(volumes ?? []).flatMap(({ id, target, name }) => [
		'--volume',
		`${dockerVolumeName(recipeId, id, name)}:${target}`,
	]);
