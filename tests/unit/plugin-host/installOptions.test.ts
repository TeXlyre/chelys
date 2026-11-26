import { describe, expect, it } from 'vitest';
import { bulkInstallOptions, canBulkInstall, recipeInstallOptions } from '@src/plugin-host/installOptions';
import type { Recipe, InstallMode, RecipeRuntimeState } from '@src/plugin-host/types';

const recipe = (...modes: InstallMode[]): Recipe => ({
	id: 'test', type: 'lsp', name: 'Test', env: {}, typeConfig: {}, modes,
});
const docker = { kind: 'docker' as const, image: 'ghcr.io/example/server:latest', buildSteps: [], runArgs: [] };
const system = { kind: 'system' as const, installSteps: [], runCommand: { command: 'server', args: [] } };
const connect = { kind: 'connect' as const };

describe('recipe installation choices', () => {
	it('offers both container sources when the recipe supports them', () => {
		const item = recipe({ ...docker, dockerfile: 'FROM scratch' }, system, connect);
		expect(recipeInstallOptions(item).map(({ id, mode, source }) => [id, mode, source])).toEqual([
			['docker-build', 'docker', 'build'], ['docker-registry', 'docker', 'registry'],
			['system', 'system', undefined], ['connect', 'connect', undefined],
		]);
		expect(canBulkInstall(item, 'not-installed')).toBe(true);
	});
	it('retains the normal install pipeline for a pull-only container', () => {
		expect(recipeInstallOptions(recipe(docker))).toEqual([
			{ id: 'docker-registry', mode: 'docker', source: 'build', label: 'Container – pull image' },
		]);
	});
	it('does not offer a registry source for a local-only Dockerfile', () => {
		expect(recipeInstallOptions(recipe({ ...docker, image: 'local-server', dockerfile: 'FROM scratch' })).map((option) => option.id)).toEqual(['docker-build']);
	});
	it('excludes installed, active, failed and mode-less recipes from initial bulk installation', () => {
		const states: RecipeRuntimeState[] = ['installed', 'stopped', 'running', 'installing', 'starting', 'stopping', 'error'];
		for (const state of states) expect(canBulkInstall(recipe(system), state)).toBe(false);
		expect(canBulkInstall(recipe(), 'not-installed')).toBe(false);
		expect(canBulkInstall(recipe(connect), 'not-installed')).toBe(true);
	});
});

it('counts pull-only and dual-source recipes together without replacing their native steps', () => {
 const a = { ...recipe(docker, system), id: 'a' };
 const b = { ...recipe({ ...docker, dockerfile: 'FROM scratch' }, connect), id: 'b' };
 const groups = bulkInstallOptions([a, b]);
 expect(groups.map(g => [g.id, g.targets.length])).toEqual([['docker-build', 1], ['docker-registry', 2], ['system', 1], ['connect', 1]]);
 expect(groups[1].targets.map(t => t.option.source)).toEqual(['build', 'registry']);
});
