// src/settings/registry.ts
import { t } from '@/i18n';
import type { Setting } from '../contexts/SettingsContext';
import { getSettingDefault } from '../config';
import { recipeRegistry } from '../plugin-host/RecipeRegistry';
import { recipeManager } from '../plugin-host/RecipeManager';
import { resetPlatformCache } from '../plugin-host/platformResolution';
import { applyCloseBehavior, applyStartOnBoot } from '../utils/systemSettings';

export const getChelysSettings = (): Setting[] => [
    {
        id: 'recipeRegistryUrl',
        category: t('Recipes'),
        subcategory: t('Registry'),
        type: 'text',
        label: t('Recipe registry URL'),
        description: t('Endpoint used to fetch the recipe registry'),
        defaultValue: getSettingDefault('recipeRegistryUrl'),
        onChange: (value) => recipeRegistry.setBaseUrl(value as string),
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
        label: t('Signaling servers'),
        description: t('Comma-separated WebRTC signaling server URLs (applied on next login)'),
        defaultValue: getSettingDefault('collabSignalingServers'),
    },
    {
        id: 'collabAutoReconnect',
        category: t('Collaboration'),
        subcategory: t('Connection'),
        type: 'checkbox',
        label: t('Auto-reconnect'),
        description: t('Automatically reconnect to peers (applied on next login)'),
        defaultValue: getSettingDefault('collabAutoReconnect'),
        liveUpdate: false,
    },
    {
        id: 'texlyreBaseUrl',
        category: t('Collaboration'),
        subcategory: t('Connection'),
        type: 'text',
        label: t('TeXlyre base URL'),
        description: t('Base URL used when generating temporary TeXlyre session links'),
        defaultValue: getSettingDefault('texlyreBaseUrl'),
    },
    {
        id: 'traefikEnabled',
        category: t('Collaboration'),
        subcategory: t('Traefik'),
        type: 'checkbox',
        label: t('Route services through Traefik'),
        description: t('Rewrite service URLs to a single Traefik entrypoint using the recipe identifier as a path, instead of per-recipe ports (applied on next start).'),
        defaultValue: getSettingDefault('traefikEnabled'),
        onChange: () => {
            void recipeManager.reinjectRunning();
        },
    },
    {
        id: 'traefikBaseUrl',
        category: t('Collaboration'),
        subcategory: t('Traefik'),
        type: 'text',
        label: t('Traefik base URL'),
        description: t('Scheme and host of the Traefik entrypoint, port optional, e.g. wss://chelys.traefik-host:8443. http/https are treated as ws/wss. Used when Traefik routing is on (applied on next start).'),
        defaultValue: getSettingDefault('traefikBaseUrl'),
        onChange: () => {
            void recipeManager.reinjectRunning();
        },
    },
    {
        id: 'serviceHost',
        category: t('Collaboration'),
        subcategory: t('Traefik'),
        type: 'text',
        label: t('Service host'),
        description: t('Host used with recipe ports when Traefik routing is off (applied on next start).'),
        defaultValue: getSettingDefault('serviceHost'),
        onChange: () => {
            void recipeManager.reinjectRunning();
        },
    },
    {
        id: 'recipePlatformOverride',
        category: t('Recipes'),
        subcategory: t('Runtime'),
        type: 'select',
        label: t('Recipe operating system'),
        description: t('Use Auto unless Chelys detects the wrong platform for system recipes.'),
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
        subcategory: t('Startup'),
        type: 'select',
        label: t('When closing the window'),
        description: t('Minimize to the system tray or quit Chelys'),
        defaultValue: getSettingDefault('closeBehavior'),
        options: [
            { label: t('Minimize to tray'), value: 'tray' },
            { label: t('Quit Chelys'), value: 'exit' },
        ],
        onChange: (value) => applyCloseBehavior(value === 'exit'),
    },
    {
        id: 'startOnBoot',
        category: t('System'),
        subcategory: t('Startup'),
        type: 'checkbox',
        label: t('Start on system boot'),
        description: t('Launch Chelys automatically when you log in (starts minimized to tray)'),
        defaultValue: getSettingDefault('startOnBoot'),
        onChange: (value) => {
            void applyStartOnBoot(value === true);
        },
    },
];
