// src/contexts/SettingsContext.tsx
import type React from 'react';
import {
    type ReactNode,
    createContext,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';

import { getActiveAccountId } from '../plugin-host/activeAccount';
import { getChelysSettingsKey } from '../config';
import { getChelysSettings } from '../settings/registry';

export type SettingType = 'checkbox' | 'select' | 'text' | 'number' | 'color';

export const DEFERRED_UPDATE_TYPES: SettingType[] = ['number', 'text'];

export interface SettingOption {
    label: string;
    value: string | number | boolean;
}

export interface Setting {
    id: string;
    category: string;
    subcategory?: string;
    type: SettingType;
    label: string;
    description?: React.ReactNode;
    defaultValue: unknown;
    value?: unknown;
    options?: SettingOption[];
    min?: number;
    max?: number;
    step?: number;
    validate?: (value: unknown) => boolean;
    onChange?: (value: unknown) => void;
    strictDefaultValue?: boolean;
    liveUpdate?: boolean;
}

export interface SettingsContextType {
    getSettings: () => Setting[];
    getSetting: (id: string) => Setting | undefined;
    batchGetSettings: (ids: string[]) => Record<string, unknown>;
    updateSetting: (id: string, value: unknown) => void;
    registerSetting: (setting: Setting) => void;
    unregisterSetting: (id: string) => void;
    getSettingsByCategory: (category: string, subcategory?: string) => Setting[];
    getCategories: () => { category: string; subcategories: string[] }[];
    searchSettings: (query: string) => {
        categories: { category: string; subcategories: string[] }[];
        allSettings: Setting[];
    };
    hasUnsavedChanges: boolean;
    needsRefresh: boolean;
}

export const SettingsContext = createContext<SettingsContextType>({
    getSettings: () => [],
    getSetting: () => undefined,
    batchGetSettings: () => ({}),
    updateSetting: () => { },
    registerSetting: () => { },
    unregisterSetting: () => { },
    getSettingsByCategory: () => [],
    getCategories: () => [],
    searchSettings: () => ({ categories: [], allSettings: [] }),
    hasUnsavedChanges: false,
    needsRefresh: false,
});

interface SettingsProviderProps {
    children: ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({
    children,
}) => {
    const [settings, setSettings] = useState<Setting[]>([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const localStorageSettingsRef = useRef<Record<string, unknown> | null>(null);
    const isLocalStorageLoaded = useRef(false);

    const getStorageKey = useCallback((): string | null => {
        const userId = getActiveAccountId();
        return userId ? getChelysSettingsKey(userId) : null;
    }, []);

    const loadStoredValue = useCallback((setting: Setting): unknown => {
        if (setting.strictDefaultValue) {
            return setting.defaultValue;
        }
        if (
            localStorageSettingsRef.current &&
            localStorageSettingsRef.current[setting.id] !== undefined
        ) {
            return localStorageSettingsRef.current[setting.id];
        }
        return setting.defaultValue;
    }, []);

    const registerSetting = useCallback(
        (setting: Setting) => {
            setSettings((prev) => {
                const idx = prev.findIndex((s) => s.id === setting.id);
                const valueToUse =
                    setting.value !== undefined
                        ? setting.value
                        : loadStoredValue(setting);

                if (setting.onChange) {
                    setTimeout(() => setting.onChange?.(valueToUse), 0);
                }

                const settingWithValue = { ...setting, value: valueToUse };

                if (idx >= 0) {
                    const updated = [...prev];
                    updated[idx] = settingWithValue;
                    return updated;
                }
                return [...prev, settingWithValue];
            });
        },
        [loadStoredValue],
    );

    const loadFromStorage = useCallback(() => {
        const storageKey = getStorageKey();
        if (!storageKey) return;

        try {
            const stored = localStorage.getItem(storageKey);
            const storedParsed = stored ? JSON.parse(stored) : null;
            localStorageSettingsRef.current = storedParsed || {};
        } catch (error) {
            console.error('Error parsing chelys settings from localStorage:', error);
            localStorage.removeItem(storageKey);
            localStorageSettingsRef.current = {};
        } finally {
            isLocalStorageLoaded.current = true;
            getChelysSettings().forEach((setting) => registerSetting(setting));
        }
    }, [getStorageKey, registerSetting]);

    useEffect(() => {
        loadFromStorage();
    }, [loadFromStorage]);

    useEffect(() => {
        const handleAccountChanged = () => loadFromStorage();
        window.addEventListener('chelys-account-changed', handleAccountChanged);
        return () =>
            window.removeEventListener(
                'chelys-account-changed',
                handleAccountChanged,
            );
    }, [loadFromStorage]);

    useEffect(() => {
        if (settings.length === 0 || !isLocalStorageLoaded.current) return;

        const storageKey = getStorageKey();
        if (!storageKey) return;

        const registeredSettings = settings.reduce(
            (acc, s) => {
                acc[s.id] = s.value;
                return acc;
            },
            {} as Record<string, unknown>,
        );

        const existingSettings = localStorageSettingsRef.current || {};
        const toSave = { ...existingSettings, ...registeredSettings };

        try {
            localStorage.setItem(storageKey, JSON.stringify(toSave));
        } catch (error) {
            console.error('Error saving chelys settings to localStorage:', error);
        }
    }, [settings, getStorageKey]);

    const getSettings = () => settings;

    const getSetting = (id: string) => settings.find((s) => s.id === id);

    const batchGetSettings = useCallback(
        (ids: string[]): Record<string, unknown> => {
            const storageKey = getStorageKey();
            if (!storageKey) return {};

            try {
                const stored = localStorage.getItem(storageKey);
                const storedSettings = stored ? JSON.parse(stored) : {};

                const result: Record<string, unknown> = {};
                for (const id of ids) {
                    const existingSetting = settings.find((s) => s.id === id);
                    if (existingSetting?.value !== undefined) {
                        result[id] = existingSetting.value;
                    } else if (storedSettings[id] !== undefined) {
                        result[id] = storedSettings[id];
                    }
                }
                return result;
            } catch {
                return {};
            }
        },
        [getStorageKey, settings],
    );

    const updateSetting = (id: string, value: unknown) => {
        setSettings((prev) =>
            prev.map((s) => {
                if (s.id !== id) return s;

                let validatedValue = value;

                if (s.type === 'number' && typeof value === 'number') {
                    if (s.min !== undefined && value < s.min) {
                        validatedValue = s.min;
                    }
                    if (s.max !== undefined && value > s.max) {
                        validatedValue = s.max;
                    }
                }

                if (s.validate && !s.validate(validatedValue)) {
                    console.warn(`Invalid value for ${id}:`, validatedValue);
                    return s;
                }

                const updated = { ...s, value: validatedValue };

                const needsLiveUpdate =
                    s.liveUpdate !== undefined
                        ? s.liveUpdate
                        : !DEFERRED_UPDATE_TYPES.includes(s.type);

                if (needsLiveUpdate && s.onChange) {
                    s.onChange(validatedValue);
                }

                if (!needsLiveUpdate) {
                    setNeedsRefresh(true);
                }

                return updated;
            }),
        );
        setHasUnsavedChanges(true);
        setTimeout(() => setHasUnsavedChanges(false), 2000);
    };

    const unregisterSetting = (id: string) => {
        setSettings((prev) => prev.filter((s) => s.id !== id));
    };

    const getSettingsByCategory = (category: string, subcategory?: string) =>
        settings.filter(
            (s) =>
                s.category === category &&
                (subcategory === undefined || s.subcategory === subcategory),
        );

    const getCategories = () => {
        const map = settings.reduce(
            (acc, s) => {
                if (!acc[s.category]) acc[s.category] = new Set<string>();
                if (s.subcategory) acc[s.category].add(s.subcategory);
                return acc;
            },
            {} as Record<string, Set<string>>,
        );
        return Object.entries(map).map(([category, subs]) => ({
            category,
            subcategories: Array.from(subs),
        }));
    };

    const searchSettings = (query: string) => {
        if (!query.trim())
            return { categories: getCategories(), allSettings: settings };

        const lowerQuery = query.toLowerCase();
        const matchingSettings = settings.filter(
            (s) =>
                s.category.toLowerCase().includes(lowerQuery) ||
                s.subcategory?.toLowerCase().includes(lowerQuery) ||
                s.label.toLowerCase().includes(lowerQuery) ||
                (typeof s.description === 'string' &&
                    s.description.toLowerCase().includes(lowerQuery)),
        );

        const categoriesMap = matchingSettings.reduce(
            (acc, s) => {
                if (!acc[s.category]) acc[s.category] = new Set<string>();
                if (s.subcategory) acc[s.category].add(s.subcategory);
                return acc;
            },
            {} as Record<string, Set<string>>,
        );

        const filteredCategories = Object.entries(categoriesMap).map(
            ([category, subs]) => ({
                category,
                subcategories: Array.from(subs),
            }),
        );

        return { categories: filteredCategories, allSettings: matchingSettings };
    };

    return (
        <SettingsContext.Provider
            value={{
                getSettings,
                getSetting,
                batchGetSettings,
                updateSetting,
                registerSetting,
                unregisterSetting,
                getSettingsByCategory,
                getCategories,
                searchSettings,
                hasUnsavedChanges,
                needsRefresh,
            }}
        >
            {children}
        </SettingsContext.Provider>
    );
};