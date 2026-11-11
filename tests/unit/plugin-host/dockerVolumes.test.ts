import { describe, expect, it } from 'vitest';
import {
	dockerVolumeArgs,
	dockerVolumeName,
} from '@src/plugin-host/dockerVolumes';

describe('docker recipe volumes', () => {
	it('supports a stable explicit volume name without renaming existing volumes', () => {
		expect(dockerVolumeName('garage-storage', 'data')).toBe(
			'chelys-garage-storage-data',
		);
		expect(dockerVolumeArgs('another-recipe', [
			{ id: 'data', target: '/var/lib/garage', name: 'chelys-garage-storage-data' },
		])).toEqual(['--volume', 'chelys-garage-storage-data:/var/lib/garage']);
		expect(() => dockerVolumeName('x', 'y', '../unsafe')).toThrow(
			'Invalid container volume name',
		);
	});

	it('maps recipe volume declarations to stable named-volume mounts', () => {
		expect(dockerVolumeName('garage/local', 'project data')).toBe(
			'chelys-garage-local-project-data',
		);
		expect(
			dockerVolumeArgs('garage/local', [
				{ id: 'data', target: '/var/lib/garage' },
				{ id: 'config', target: '/etc/garage' },
			]),
		).toEqual([
			'--volume',
			'chelys-garage-local-data:/var/lib/garage',
			'--volume',
			'chelys-garage-local-config:/etc/garage',
		]);
	});
});
