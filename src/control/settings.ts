// src/control/settings.ts
import { isThemeColorId } from '../../external/texlyre/extras/themes/shared/colors';
import { getActiveAccountId } from '../plugin-host/activeAccount';
import { getChelysSettingsKey, SETTINGS_DEFAULTS } from '../config';

const settingsKey = (): string => {
	const account = getActiveAccountId();
	if (!account) throw new Error('Login required');
	return getChelysSettingsKey(account);
};

const supported = (id: string): void => {
	if (!Object.hasOwn(SETTINGS_DEFAULTS, id))
		throw new Error(`Unknown Chelys setting: ${id}`);
};

function saved(): Record<string, unknown> {
	const raw = localStorage.getItem(settingsKey());
	if (!raw) return {};
	const data: unknown = JSON.parse(raw);
	if (!data || typeof data !== 'object' || Array.isArray(data))
		throw new Error('Invalid Chelys settings data');
	return data as Record<string, unknown>;
}

function validate(id: string, value: unknown): void {
	const fallback = SETTINGS_DEFAULTS[id];
	if (
		typeof value !== typeof fallback ||
		(typeof value === 'number' && !Number.isFinite(value))
	) {
		throw new Error(`Chelys setting ${id} requires a ${typeof fallback}`);
	}
	if (id === 'themeVariant' && value !== 'system' && !isThemeColorId(value as string)) {
		throw new Error('Unknown Chelys theme variant');
	}
	const choices: Record<string, string[]> = {
		defaultContainerEngine: ['docker', 'podman'],
		recipePlatformOverride: ['auto', 'windows', 'macos', 'linux'],
		closeBehavior: ['tray', 'exit'],
	};
	if (choices[id] && !choices[id].includes(value as string)) {
		throw new Error(
			`Chelys setting ${id} must be one of: ${choices[id].join(', ')}`,
		);
	}
	if (
		id === 'traefikRouteServerPort' &&
		(!Number.isInteger(value) ||
			(value as number) < 1024 ||
			(value as number) > 65535)
	) {
		throw new Error('Traefik route server port must be between 1024 and 65535');
	}
}

function publish(id: string): void {
	window.dispatchEvent(
		new CustomEvent('chelys-settings-changed', {
			detail: { id, value: chelysSettings.get(id) },
		}),
	);
}

export const chelysSettings = {
	list(): string[] {
		settingsKey();
		return Object.keys(SETTINGS_DEFAULTS);
	},
	get(id: string): unknown {
		supported(id);
		const stored = saved();
		return stored[id] ?? SETTINGS_DEFAULTS[id];
	},
	set(id: string, value: unknown): void {
		supported(id);
		validate(id, value);
		localStorage.setItem(
			settingsKey(),
			JSON.stringify({ ...saved(), [id]: value }),
		);
		publish(id);
	},
	delete(id: string): void {
		supported(id);
		const values = saved();
		delete values[id];
		localStorage.setItem(settingsKey(), JSON.stringify(values));
		publish(id);
	},
};
