import { describe, expect, it } from 'vitest';
import {
	dockerVolumeArgs,
	dockerVolumeName,
} from '@src/plugin-host/dockerVolumes';

describe('docker recipe volumes', () => {
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
