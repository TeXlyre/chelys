// src/plugin-host/dockerVolumes.ts
import type { DockerVolume } from './types';

const safeVolumePart = (value: string): string =>
	value.replace(/[^a-zA-Z0-9_.-]/g, '-');

export const dockerVolumeName = (recipeId: string, volumeId: string): string =>
	`chelys-${safeVolumePart(recipeId)}-${safeVolumePart(volumeId)}`;

export const dockerVolumeArgs = (
	recipeId: string,
	volumes: DockerVolume[] | undefined,
): string[] =>
	(volumes ?? []).flatMap(({ id, target }) => [
		'--volume',
		`${dockerVolumeName(recipeId, id)}:${target}`,
	]);
