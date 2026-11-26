// src/settings/registry.ts
import { t } from '@/i18n';
import type { Setting } from '../contexts/SettingsContext';
import { getSettingDefault } from '../config';
import { resetPlatformCache } from '../plugin-host/platformResolution';
import { applyCloseBehavior } from '../utils/systemSettings';
import { localCommand } from '../control/localClient';
import { flushSharedStorage } from '../runtime/storageMirror';

import {
	getInitialVariant,
	normalizeVariant,
	setThemeVariant,
	themeOptions,
} from '../theme/themeVariant';

const reinjectBackend = () => {
	void flushSharedStorage()
		.then(() => localCommand('recipes.reinject'))
		.catch((error) =>
			console.error('[Chelys] Could not update backend recipes', error),
		);
};

export const getChelysSettings = (): Setting[] => [
	{
		id: 'themeVariant',
		category: t('Appearance'),
		subcategory: t('Theme'),
		type: 'select',
		label: t('Variant'),
		description: t('Select the theme variant (color palette)'),
		defaultValue: getInitialVariant(),
		options: themeOptions.map((option) => ({
			...option,
			label: t(option.label),
		})),
		liveUpdate: true,
		validate: (value) => normalizeVariant(value) === value,
		onChange: setThemeVariant,
	},
	{
		id: 'recipeRegistryUrl',
		category: t('Recipes'),
		subcategory: t('Registry'),
		type: 'text',
		label: t('Recipe registry URLs'),
		description: t(
			'Comma-separated recipe registry URLs (first registry takes precedence)',
		),
		defaultValue: getSettingDefault('recipeRegistryUrl'),
	},
	{
		id: 'enableCodedSeeds',
		category: t('Recipes'),
		subcategory: t('Registry'),
		type: 'checkbox',
		label: t('Enable coded seeds'),
		description: t('Include built-in seed recipes'),
		defaultValue: getSettingDefault('enableCodedSeeds'),
	},
	{
		id: 'collabSignalingServers',
		category: t('Collaboration'),
		subcategory: t('Connection'),
		type: 'text',
		label: t('Signaling servers (WebRTC)'),
		description: t('Comma-separated list of Yjs WebRTC signaling server URLs'),
		defaultValue: getSettingDefault('collabSignalingServers'),
	},
	{
		id: 'collabAutoReconnect',
		category: t('Collaboration'),
		subcategory: t('Connection'),
		type: 'checkbox',
		label: t('Auto-reconnect on disconnect'),
		description: t(
			'Automatically attempt to reconnect when the connection is lost',
		),
		defaultValue: getSettingDefault('collabAutoReconnect'),
		liveUpdate: false,
	},
	{
		id: 'texlyreBaseUrl',
		category: t('Collaboration'),
		subcategory: t('Connection'),
		type: 'text',
		label: t('TeXlyre base URL'),
		description: t(
			'Base URL used when generating temporary TeXlyre session links',
		),
		defaultValue: getSettingDefault('texlyreBaseUrl'),
	},
	{
		id: 'traefikEnabled',
		category: t('Collaboration'),
		subcategory: t('Traefik'),
		type: 'checkbox',
		label: t('Route services through Traefik'),
		description: t(
			'Route recipe endpoints through a single Traefik entrypoint using recipe identifiers as paths',
		),
		defaultValue: getSettingDefault('traefikEnabled'),
		onChange: reinjectBackend,
	},
	{
		id: 'traefikBaseUrl',
		category: t('Collaboration'),
		subcategory: t('Traefik'),
		type: 'text',
		label: t('Traefik base URL'),
		description: t(
			'Traefik entrypoint URL with an optional port (HTTP and HTTPS are converted to WebSocket URLs)',
		),
		defaultValue: getSettingDefault('traefikBaseUrl'),
		onChange: reinjectBackend,
	},
	{
		id: 'traefikBackendHost',
		category: t('Collaboration'),
		subcategory: t('Traefik'),
		type: 'text',
		label: t('Traefik backend host'),
		description: t(
			'Host Traefik uses to reach local recipes (auto selects the appropriate host for the platform and installation mode)',
		),
		defaultValue: getSettingDefault('traefikBackendHost'),
		onChange: reinjectBackend,
	},
	{
		id: 'traefikRouteServerPort',
		category: t('Collaboration'),
		subcategory: t('Traefik'),
		type: 'number',
		label: t('Route table port'),
		description: t(
			'Port for the Traefik routing table (a free port is selected if unavailable). Restart Chelys and Traefik after changing this setting',
		),
		defaultValue: getSettingDefault('traefikRouteServerPort'),
		min: 1024,
		max: 65535,
	},
	{
		id: 'serviceHost',
		category: t('Collaboration'),
		subcategory: t('Traefik'),
		type: 'text',
		label: t('Service host'),
		description: t(
			'Host used with recipe ports when Traefik routing is disabled',
		),
		defaultValue: getSettingDefault('serviceHost'),
		onChange: reinjectBackend,
	},
	{
		id: 'dynamicPortFallback',
		category: t('Recipes'),
		subcategory: t('Runtime'),
		type: 'checkbox',
		label: t('Fall back to a free port'),
		description: t(
			'Select a free port when a configured recipe or Traefik routing table port is unavailable',
		),
		defaultValue: getSettingDefault('dynamicPortFallback'),
	},
	{
		id: 'defaultContainerEngine',
		category: t('Recipes'),
		subcategory: t('Runtime'),
		type: 'select',
		label: t('Default container engine'),
		description: t(
			'Container engine used when installing recipes without an engine override',
		),
		defaultValue: getSettingDefault('defaultContainerEngine'),
		options: [
			{ label: t('Docker'), value: 'docker' },
			{ label: t('Podman'), value: 'podman' },
		],
	},
	{
		id: 'podmanUnqualifiedSearchRegistries',
		category: t('Recipes'),
		subcategory: t('Runtime'),
		type: 'text',
		label: t('Podman unqualified search registries'),
		description: t(
			'Comma-separated registries used by Podman to resolve unqualified image names (leave empty to use Podman configuration)',
		),
		defaultValue: getSettingDefault('podmanUnqualifiedSearchRegistries'),
		dependsOn: { id: 'defaultContainerEngine', value: 'podman', nest: true },
		disabledReason: t('Available when: Default container engine is Podman'),
		liveUpdate: true,
	},
	{
		id: 'recipePlatformOverride',
		category: t('Recipes'),
		subcategory: t('Runtime'),
		type: 'select',
		label: t('Recipe operating system'),
		description: t(
			'Operating system used to resolve platform-specific system recipes',
		),
		defaultValue: getSettingDefault('recipePlatformOverride'),
		options: [
			{ label: t('Auto-detect'), value: 'auto' },
			{ label: t('Windows'), value: 'windows' },
			{ label: t('macOS'), value: 'macos' },
			{ label: t('Linux'), value: 'linux' },
		],
		onChange: () => {
			resetPlatformCache();
			window.dispatchEvent(new CustomEvent('chelys-platform-changed'));
		},
	},
	{
		id: 'closeBehavior',
		category: t('System'),
		subcategory: t('Runtime'),
		type: 'select',
		label: t('When closing the window'),
		description: t(
			'Choose whether to hide the window or quit Chelys. Only desktop-managed backends stop when the desktop quits',
		),
		defaultValue: getSettingDefault('closeBehavior'),
		options: [
			{ label: t('Hide to system tray'), value: 'tray' },
			{ label: t('Quit Chelys desktop'), value: 'exit' },
		],
		onChange: (value) => applyCloseBehavior(value === 'exit'),
	},
];
