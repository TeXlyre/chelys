// src/theme/themeVariant.ts
// Chelys appearance uses the upstream TeXlyre palette definitions.
import {
	isThemeColorId,
	themes,
	type ThemeColorId,
} from '../../external/texlyre/extras/themes/shared/colors';
import config from '../../chelys.config';

const STORAGE_KEY = 'chelys-theme-variant';
const DARK_VARIANTS = new Set<ThemeColorId>([
	'dark',
	'monokai',
	'tomorrow_night_blue',
	'nord',
	'deuteranopia',
]);
export type ThemeVariant = 'dark' | 'light';
export type ThemePreference = ThemeColorId | 'system';
export const themeOptions = [
	{ value: 'system', label: 'System' },
	...Object.keys(themes).map((value) => ({
		value,
		label: value
			.split('_')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' '),
	})),
];

export function normalizeVariant(value: unknown): ThemePreference {
	return typeof value === 'string' &&
		(value === 'system' || isThemeColorId(value))
		? value
		: 'light';
}

export function getInitialVariant(): ThemePreference {
	try {
		return normalizeVariant(
			localStorage.getItem(STORAGE_KEY) ??
				config.userdata.default.settings.themeVariant,
		);
	} catch {
		return normalizeVariant(config.userdata.default.settings.themeVariant);
	}
}

export function applyThemeVariant(value: unknown): void {
	const preference = normalizeVariant(value);
	const variant =
		preference === 'system'
			? window.matchMedia('(prefers-color-scheme: dark)').matches
				? 'dark'
				: 'light'
			: preference;
	const mode = DARK_VARIANTS.has(variant) ? 'dark' : 'light';
	const root = document.documentElement;
	for (const [key, color] of Object.entries(themes[variant])) {
		root.style.setProperty(`--pico-${key}`, color);
	}
	root.style.setProperty('--text-color', themes[variant].color);
	root.setAttribute('data-theme', variant);
	root.setAttribute('data-theme-mode', mode);
	root.style.colorScheme = mode;
}

export function setThemeVariant(value: unknown): void {
	const preference = normalizeVariant(value);
	applyThemeVariant(preference);
	try {
		if (localStorage.getItem(STORAGE_KEY) !== preference)
			localStorage.setItem(STORAGE_KEY, preference);
	} catch {
		// The active palette remains usable even if local storage is unavailable.
	}
}

export function nextThemeVariant(mode: ThemeVariant): ThemeColorId {
	const target =
		mode === 'dark' ? config.themeToggle.light : config.themeToggle.dark;
	const fallback = mode === 'dark' ? 'light' : 'dark';
	if (
		!isThemeColorId(target) ||
		DARK_VARIANTS.has(target) !== (fallback === 'dark')
	)
		return fallback;
	return target;
}
