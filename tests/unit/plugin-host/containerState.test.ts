// tests/unit/plugin-host/containerState.test.ts
import { describe, expect, it } from 'vitest';
import { containerStateFromInspect } from '@src/plugin-host/containerState';

describe('Docker/Podman recipe container recovery', () => {
	it('adopts live named containers instead of starting another', () => {
		expect(containerStateFromInspect(0, ['running'], 'chelys-sile')).toBe('running');
	});

	it('resumes an existing stopped or created container rather than replacing it', () => {
		for (const state of ['exited', 'stopped', 'created', 'configured', 'initialized', 'dead']) {
			expect(containerStateFromInspect(0, [state], 'chelys-sile')).toBe('stopped');
		}
	});

	it('treats only an explicit missing-container response as absent', () => {
		expect(containerStateFromInspect(125, ['Error: no such container chelys-sile'], 'chelys-sile')).toBe('absent');
		expect(containerStateFromInspect(1, ['Error: No such object: chelys-sile'], 'chelys-sile')).toBe('absent');
		expect(() => containerStateFromInspect(125, ['Error: cannot connect to Podman socket'], 'chelys-sile'))
			.toThrow('Cannot inspect container');
	});

	it('fails closed for unknown, paused, and restarting containers', () => {
		for (const state of ['paused', 'restarting', 'removing', '']) {
			expect(() => containerStateFromInspect(0, [state], 'chelys-sile')).toThrow('chelys-sile');
		}
	});
});
