// tests/unit/control/monitor.test.ts
import { describe, expect, it } from 'vitest';
import { latestMonitorSnapshot, METRICS_PREFIX, MONITOR_FIELDS, systemMonitorRecipe, supportsSystemMonitor } from '@src/plugins/infrastructure/systemMonitor';
import type { RecipeStatus } from '@src/plugin-host/types';

const makeStatus = (state: RecipeStatus['state'], lines: string[]): RecipeStatus => ({
	recipeId: 'system-monitor', state, mode: 'system', lastError: null, logTail: lines,
});

const sample = (date: string) => METRICS_PREFIX + JSON.stringify({
	v: 1, sampledAt: date, scope: 'system', metrics: { cpu: { cores: 4 } },
});

describe('System Monitor infrastructure recipe', () => {
	it('offers regular system and isolated Docker modes without privileged mounts', () => {
		expect(systemMonitorRecipe.type).toBe('infrastructure');
		expect(systemMonitorRecipe.modes.map((mode) => mode.kind)).toEqual(['system', 'docker']);
		const docker = systemMonitorRecipe.modes.find((mode) => mode.kind === 'docker');
		expect(docker && 'runArgs' in docker && docker.runArgs).toContain('--cap-drop=ALL');
		expect(docker && 'runArgs' in docker && docker.runArgs).toContain('--read-only');
		expect(docker && 'runArgs' in docker && docker.runArgs).toContain('CHELYS_MONITOR_SCOPE=container');
		expect(MONITOR_FIELDS.map((field) => field.id)).toContain('energy');
		expect(supportsSystemMonitor(systemMonitorRecipe)).toBe(true);
	});

	it('accepts valid recent reports and ignores malformed, stopped or stale reports', () => {
		const recent = sample(new Date().toISOString());
		expect(latestMonitorSnapshot(makeStatus('running', ['noise', recent]))?.metrics.cpu).toEqual({ cores: 4 });
		expect(latestMonitorSnapshot(makeStatus('stopped', [recent]))).toBeNull();
		expect(latestMonitorSnapshot(makeStatus('running', [sample(new Date(Date.now() - 60_000).toISOString())]))).toBeNull();
		expect(latestMonitorSnapshot(makeStatus('running', [METRICS_PREFIX + '{broken']))).toBeNull();
	});
});
