// src/plugin-host/traefikRoutes.ts
import { appDataDir, join } from '@tauri-apps/api/path';
import {
    BaseDirectory,
    mkdir,
    readDir,
    remove,
    writeTextFile,
} from '@tauri-apps/plugin-fs';

import { getStoredSetting } from '../config';
import { effectiveValues } from './variableResolution';
import type { Recipe } from './types';

const ROUTES_DIR = 'traefik/routes';

interface RouteInfo {
    configId: string;
    port: string;
}

const safeName = (configId: string): string =>
    configId.replace(/[^a-zA-Z0-9_.-]/g, '-');

const routeFile = (configId: string): string =>
    `${ROUTES_DIR}/${safeName(configId)}.yml`;

const configIdOf = (recipe: Recipe): string => {
    const typeConfig = recipe.typeConfig as { configId?: unknown };
    return typeof typeConfig.configId === 'string'
        ? typeConfig.configId
        : recipe.id;
};

const routeInfo = (recipe: Recipe): RouteInfo | null => {
    const configId = configIdOf(recipe);
    if (!configId) return null;

    const values = effectiveValues(recipe);
    const portKey = Object.keys(values).find((key) => /port$/i.test(key));
    const port = portKey ? values[portKey] : '';
    if (!/^\d+$/.test(port)) return null;

    return { configId, port };
};

const routeYaml = (info: RouteInfo): string => {
    const id = safeName(info.configId);
    return [
        'http:',
        '  routers:',
        `    ${id}:`,
        `      rule: "PathPrefix(\`/${id}\`)"`,
        `      service: ${id}`,
        '      middlewares:',
        `        - ${id}-strip`,
        '  middlewares:',
        `    ${id}-strip:`,
        '      stripPrefix:',
        '        prefixes:',
        `          - "/${id}"`,
        '  services:',
        `    ${id}:`,
        '      loadBalancer:',
        '        servers:',
        `          - url: "http://127.0.0.1:${info.port}"`,
        '',
    ].join('\n');
};

export async function routesDir(): Promise<string> {
    return join(await appDataDir(), ROUTES_DIR);
}

const ensureDir = async (): Promise<void> => {
    await mkdir(ROUTES_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
};

export async function writeRoute(recipe: Recipe): Promise<void> {
    if (!getStoredSetting<boolean>('traefikEnabled')) {
        await removeRoute(recipe);
        return;
    }

    const info = routeInfo(recipe);
    if (!info) return;

    try {
        await ensureDir();
        await writeTextFile(routeFile(info.configId), routeYaml(info), {
            baseDir: BaseDirectory.AppData,
        });
    } catch (error) {
        console.error('[traefik] failed to write route', error);
    }
}

export async function removeRoute(recipe: Recipe): Promise<void> {
    const configId = configIdOf(recipe);
    if (!configId) return;

    try {
        await remove(routeFile(configId), { baseDir: BaseDirectory.AppData });
    } catch {
        /* file may not exist */
    }
}

export async function reconcileRoutes(runningConfigIds: string[]): Promise<void> {
    const keep = new Set(runningConfigIds.map(safeName));

    try {
        const entries = await readDir(ROUTES_DIR, { baseDir: BaseDirectory.AppData });

        for (const entry of entries) {
            if (!entry.isFile || !entry.name.endsWith('.yml')) continue;

            const id = entry.name.replace(/\.yml$/, '');
            if (keep.has(id)) continue;

            await remove(`${ROUTES_DIR}/${entry.name}`, {
                baseDir: BaseDirectory.AppData,
            }).catch(() => undefined);
        }
    } catch {
        /* directory may not exist yet */
    }
}
