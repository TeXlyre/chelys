import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../../../chelys.config';
import { themes } from '../../../external/texlyre/extras/themes/shared/colors';
import {
	applyThemeVariant,
	getInitialVariant,
	nextThemeVariant,
	setThemeVariant,
	themeOptions,
} from '../../../src/theme/themeVariant';

describe('Chelys appearance', () => {
	const storage = new Map<string, string>();
	const attributes = new Map<string, string>();
	const properties = new Map<string, string>();
	let dark = false;
	const targets = { ...config.themeToggle };

	beforeEach(() => {
		storage.clear();
		attributes.clear();
		properties.clear();
		dark = false;
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
		});
		vi.stubGlobal('window', { matchMedia: () => ({ matches: dark }) });
		vi.stubGlobal('document', {
			documentElement: {
				style: { setProperty: (key: string, value: string) => properties.set(key, value) },
				setAttribute: (key: string, value: string) => attributes.set(key, value),
			},
		});
	});

	afterEach(() => {
		Object.assign(config.themeToggle, targets);
		vi.unstubAllGlobals();
	});

	it('exposes every upstream palette and persists it independently of TeXlyre', () => {
		expect(themeOptions.map((option) => option.value)).toEqual(['system', ...Object.keys(themes)]);
		for (const [variant, colors] of Object.entries(themes)) {
			setThemeVariant(variant);
			expect(getInitialVariant()).toBe(variant);
			expect(attributes.get('data-theme')).toBe(variant);
			expect(properties.get('--pico-primary')).toBe(colors.primary);
			expect(properties.get('--text-color')).toBe(colors.color);
		}
		expect([...storage.keys()]).toEqual(['chelys-theme-variant']);
	});

	it('keeps system preference while resolving its actual colour mode', () => {
		setThemeVariant('system');
		expect(attributes.get('data-theme-mode')).toBe('light');
		dark = true;
		applyThemeVariant(getInitialVariant());
		expect(attributes.get('data-theme')).toBe('dark');
		expect(getInitialVariant()).toBe('system');
	});

	it('uses configured toggle targets and safely handles invalid combinations', () => {
		config.themeToggle.light = 'solarized_light';
		config.themeToggle.dark = 'nord';
		expect(nextThemeVariant('light')).toBe('nord');
		expect(nextThemeVariant('dark')).toBe('solarized_light');
		config.themeToggle.dark = 'light';
		expect(nextThemeVariant('light')).toBe('dark');
		setThemeVariant('unknown');
		expect(getInitialVariant()).toBe('light');
	});
});
