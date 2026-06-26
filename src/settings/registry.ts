// src/settings/registry.ts
import { t } from '@/i18n';
import type { Setting } from '../contexts/SettingsContext';
import { getSettingDefault } from '../config';
import { recipeRegistry } from '../plugin-host/RecipeRegistry';
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