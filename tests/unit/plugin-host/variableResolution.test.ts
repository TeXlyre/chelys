import { describe, expect, it } from 'vitest';
import {
	canPullImage,
	effectiveValues,
	registryPullSteps,
	resolveCommand,
	resolveRecipe,
	withoutSecretValues,
} from '@src/plugin-host/variableResolution';
import type { DockerMode, Recipe } from '@src/plugin-host/types';

const recipe = (docker: DockerMode): Recipe => ({
	id: 'resolver-test',
	type: 'lsp',
	name: 'Resolver test',
	env: {
		PORT: '${PORT}',
		UNCHANGED: '${MISSING}',
	},
	cwd: '/tmp/${NAME}',
	variables: [
		{ key: 'PORT', label: 'Port', kind: 'number', default: '7000' },
		{ key: 'NAME', label: 'Name', kind: 'text', default: 'default' },
	],
	variableValues: { PORT: '7100', NAME: 'custom' },
	typeConfig: {
		transportType: 'webrtc',
		transportUrl: 'ws://localhost:${PORT}',
		nested: { label: '${NAME}' },
	},
	modes: [docker],
});

describe('recipe variable resolution', () => {
	it('uses declared defaults with explicit values taking precedence', () => {
		expect(effectiveValues(recipe({
			kind: 'docker',
			image: 'example/server:latest',
			buildSteps: [],
			runArgs: [],
		}))).toEqual({ PORT: '7100', NAME: 'custom' });
	});

	it('substitutes variables throughout recipe data while preserving unknown tokens', () => {
		const resolved = resolveRecipe(
			recipe({
				kind: 'docker',
				image: 'example/server:${NAME}',
				buildSteps: [
					{ label: 'Prepare ${NAME}', command: 'echo', args: ['${PORT}'] },
				],
				runArgs: ['-p', '${PORT}:${PORT}'],
			}),
		);
		const docker = resolved.modes[0];

		expect(resolved.env).toEqual({ PORT: '7100', UNCHANGED: '${MISSING}' });
		expect(resolved.cwd).toBe('/tmp/custom');
		expect(resolved.typeConfig.nested).toEqual({ label: 'custom' });
		expect(docker.kind === 'docker' && docker.image).toBe(
			'example/server:custom',
		);
		expect(docker.kind === 'docker' && docker.runArgs).toEqual([
			'-p',
			'7100:7100',
		]);
	});

	it('adds a pull step when the recipe has no Dockerfile', () => {
		const resolved = resolveRecipe(
			recipe({
				kind: 'docker',
				image: 'example/server:latest',
				buildSteps: [],
				runArgs: [],
			}),
		);
		const docker = resolved.modes[0];

		expect(docker.kind === 'docker' && docker.buildSteps).toEqual([
			{
				label: 'Pull image',
				command: 'docker',
				args: ['pull', 'example/server:latest'],
			},
		]);
	});

	it('downloads a remote Dockerfile and builds instead of pulling the image', () => {
		const resolved = resolveRecipe(
			recipe({
				kind: 'docker',
				image: 'registry.example.com/server:latest',
				buildSteps: [],
				runArgs: [],
				dockerfileUrl: 'https://example.com/Dockerfile',
			}),
		);
		const docker = resolved.modes[0];

		expect(docker.kind === 'docker' && docker.buildSteps).toEqual([
			{
				label: 'Download Dockerfile',
				command: 'curl',
				args: [
					'-fL',
					'-o',
					'Dockerfile.chelys',
					'https://example.com/Dockerfile',
				],
			},
			{
				label: 'Build image',
				command: 'docker',
				args: [
					'build',
					'-f',
					'Dockerfile.chelys',
					'-t',
					'registry.example.com/server:latest',
					'.',
				],
			},
		]);
	});

	it('builds an inline Dockerfile and exposes registry-pull steps with the target platform', () => {
		const docker: DockerMode = {
			kind: 'docker',
			image: 'registry.example.com/server:latest',
			buildSteps: [],
			runArgs: [],
			dockerfile: 'FROM scratch',
		};
		const resolved = resolveRecipe(recipe(docker));
		const resolvedDocker = resolved.modes[0];

		expect(resolvedDocker.kind === 'docker' && resolvedDocker.buildSteps).toEqual([
			{
				label: 'Build image',
				command: 'docker',
				args: [
					'build',
					'-f',
					'Dockerfile.chelys',
					'-t',
					'registry.example.com/server:latest',
					'.',
				],
			},
		]);
		expect(canPullImage(docker)).toBe(true);
		expect(registryPullSteps(docker, 'linux/arm64')[0]?.args).toEqual([
			'pull',
			'--platform',
			'linux/arm64',
			'registry.example.com/server:latest',
		]);
	});

	it('resolves command arguments, environment and cwd using the same substitution rules', () => {
		expect(
			resolveCommand(
				{
					command: 'server-${NAME}',
					args: ['--port', '${PORT}'],
					env: { SERVICE: '${NAME}', OTHER: '${MISSING}' },
					cwd: '/srv/${NAME}',
				},
				{ NAME: 'ltex', PORT: '7020' },
			),
		).toEqual({
			command: 'server-ltex',
			args: ['--port', '7020'],
			env: { SERVICE: 'ltex', OTHER: '${MISSING}' },
			cwd: '/srv/ltex',
		});
	});

	describe('secret variables', () => {
		const withKey = (value?: string): Recipe => ({
			id: 'agent',
			type: 'acp',
			name: 'Agent',
			env: { ANTHROPIC_API_KEY: '${apiKey}', OTHER: 'x-${apiKey}' },
			variables: [
				{ key: 'apiKey', label: 'API key', kind: 'secret', default: '' },
				{ key: 'wsPort', label: 'Port', kind: 'number', default: '7060' },
			],
			variableValues: value === undefined ? undefined : { apiKey: value, wsPort: '7061' },
			typeConfig: { transportUrl: 'ws://localhost:${wsPort}', leak: '${apiKey}' },
			modes: [
				{
					kind: 'system',
					installSteps: [{ label: 'Echo', command: 'echo', args: ['${apiKey}'] }],
					runCommand: { command: 'run', args: ['--key', '${apiKey}'] },
				},
			],
		});

		it('goes into env only, never into commands or the config block', () => {
			const resolved = resolveRecipe(withKey('sk-test'));
			expect(resolved.env).toEqual({ ANTHROPIC_API_KEY: 'sk-test', OTHER: 'x-sk-test' });
			expect(resolved.typeConfig).toEqual({
				transportUrl: 'ws://localhost:7061',
				leak: '${apiKey}',
			});
			expect(JSON.stringify(resolved.modes)).not.toContain('sk-test');
		});

		it('leaves the inherited variable in place when empty', () => {
			expect(resolveRecipe(withKey('')).env).toEqual({ OTHER: 'x-' });
			expect(resolveRecipe(withKey()).env).toEqual({ OTHER: 'x-' });
		});

		it('is left out of a downloaded recipe', () => {
			expect(withoutSecretValues(withKey('sk-test')).variableValues).toEqual({
				wsPort: '7061',
			});
			const plain = withKey();
			expect(withoutSecretValues(plain)).toBe(plain);
		});
	});
});
