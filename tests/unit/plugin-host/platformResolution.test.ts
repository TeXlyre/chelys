import { describe, expect, it } from 'vitest';
import {
	applyPlatform,
	dockerPlatform,
	normalizePlatform,
} from '@src/plugin-host/platformResolution';
import type { Recipe } from '@src/plugin-host/types';

const baseRecipe = (): Recipe => ({
	id: 'platform-test',
	type: 'lsp',
	name: 'Platform test',
	env: {},
	typeConfig: {},
	modes: [
		{
			kind: 'system',
			installSteps: [{ label: 'default install', command: 'install', args: [] }],
			uninstallSteps: [
				{ label: 'default uninstall', command: 'uninstall', args: [] },
			],
			runCommand: { command: 'server', args: ['--default'] },
			platforms: {
				windows: {
					installSteps: [
						{ label: 'windows install', command: 'winget', args: ['install'] },
					],
					runCommand: { command: 'server.exe', args: ['--windows'] },
				},
			},
		},
		{
			kind: 'docker',
			image: 'example/server:latest',
			buildSteps: [],
			runArgs: ['--network', 'host'],
			command: ['serve'],
			platforms: {
				macos: {
					runArgs: ['--add-host', 'host.docker.internal:host-gateway'],
				},
			},
		},
	],
});

describe('platform resolution', () => {
	it.each([
		['win32', 'windows'],
		['Windows', 'windows'],
		['darwin', 'macos'],
		['macOS', 'macos'],
		['linux', 'linux'],
	])('normalizes %s to %s', (input, expected) => {
		expect(normalizePlatform(input)).toBe(expected);
	});

	it('applies only the matching system overrides and preserves unspecified steps', () => {
		const recipe = baseRecipe();
		const resolved = applyPlatform(recipe, 'windows');
		const system = resolved.modes[0];

		expect(system.kind).toBe('system');
		if (system.kind !== 'system') throw new Error('expected system mode');

		expect(system.installSteps[0]?.command).toBe('winget');
		expect(system.runCommand).toEqual({
			command: 'server.exe',
			args: ['--windows'],
		});
		expect(system.uninstallSteps?.[0]?.command).toBe('uninstall');

		const originalSystem = recipe.modes[0];
		expect(originalSystem.kind === 'system' && originalSystem.runCommand.command).toBe(
			'server',
		);
	});

	it('applies docker overrides without discarding the base command', () => {
		const resolved = applyPlatform(baseRecipe(), 'darwin');
		const docker = resolved.modes[1];

		expect(docker.kind).toBe('docker');
		if (docker.kind !== 'docker') throw new Error('expected docker mode');

		expect(docker.runArgs).toEqual([
			'--add-host',
			'host.docker.internal:host-gateway',
		]);
		expect(docker.command).toEqual(['serve']);
	});

	it('maps detected architectures to Docker platform identifiers', () => {
		expect(dockerPlatform('amd64')).toBe('linux/amd64');
		expect(dockerPlatform('arm64')).toBe('linux/arm64');
		expect(dockerPlatform(null)).toBeNull();
	});
});
