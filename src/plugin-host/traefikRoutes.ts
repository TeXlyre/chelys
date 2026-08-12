// src/plugin-host/traefikRoutes.ts
import { invoke } from '@tauri-apps/api/core';

import { getStoredSetting } from '../config';
import { safeName } from './traefikRouting';
import { effectiveValues } from './variableResolution';
import type { Recipe } from './types';

const DEFAULT_ROUTE_SERVER_PORT = 8099;
const NOOP_SERVICE = 'chelys-placeholder';

interface RouteInfo {
    configId: string;
    port: string;
}

interface RouteServerHandle {
    token: string;
    port: number;
}

const routes = new Map<string, RouteInfo>();
let server: RouteServerHandle | null = null;

const backendHost = (): string =>
    getStoredSetting<string>('traefikBackendHost').trim() || '127.0.0.1';

const configIdOf = (recipe: Recipe): string => {
    const typeConfig = recipe.typeConfig as { configId?: unknown };
    return typeof typeConfig.configId === 'string'
        ? typeConfig.configId
        : recipe.id;
};

const routeInfo = (recipe: Recipe): RouteInfo | null => {
    const configId = configIdOf(recipe);
    if (!configId) return null;

    const { transportType } = recipe.typeConfig as { transportType?: unknown };
    if (transportType === 'webrtc') return null;

    const values = effectiveValues(recipe);
    const portKey = Object.keys(values).find((key) => /port$/i.test(key));
    const port = portKey ? values[portKey] : '';
    if (!/^\d+$/.test(port)) return null;

    return { configId, port };
};


const dynamicConfig = () => {
    const routers: Record<string, unknown> = {};
    const middlewares: Record<string, unknown> = {};
    const services: Record<string, unknown> = {
        [NOOP_SERVICE]: {
            loadBalancer: { servers: [{ url: 'http://127.0.0.1:1' }] },
        },
    };

    for (const info of routes.values()) {
        const id = safeName(info.configId);

        routers[id] = {
            entryPoints: ['web'],
            rule: `PathPrefix(\`/${id}\`)`,
            service: id,
            middlewares: [`${id}-strip`],
        };
        middlewares[`${id}-strip`] = { stripPrefix: { prefixes: [`/${id}`] } };
        services[id] = {
            loadBalancer: {
                servers: [{ url: `http://${backendHost()}:${info.port}` }],
            },
        };
    }

    return {
        http: {
            ...(Object.keys(routers).length > 0 ? { routers } : {}),
            ...(Object.keys(middlewares).length > 0 ? { middlewares } : {}),
            services,
        },
    };
};

const ensureServer = async (): Promise<RouteServerHandle> => {
    if (!server) {
        const preferred = Number(getStoredSetting('traefikRouteServerPort'));

        server = await invoke<RouteServerHandle>('traefik_start_route_server', {
            port:
                Number.isInteger(preferred) && preferred > 0 && preferred < 65536
                    ? preferred
                    : DEFAULT_ROUTE_SERVER_PORT,
            fallback: getStoredSetting<boolean>('dynamicPortFallback'),
        });
    }

    return server;
};

const publish = async (): Promise<void> => {
    try {
        await ensureServer();
        await invoke('traefik_set_routes', { config: dynamicConfig() });
    } catch (error) {
        console.error('[traefik] failed to publish routes', error);
    }
};

export async function routeEndpoint(): Promise<string> {
    try {
        const { token, port } = await ensureServer();
        return `http://${backendHost()}:${port}/${token}`;
    } catch (error) {
        console.error('[traefik] route table server unavailable', error);
        return '';
    }
}

export async function writeRoute(recipe: Recipe): Promise<void> {
    if (!getStoredSetting<boolean>('traefikEnabled')) {
        await removeRoute(recipe);
        return;
    }

    const info = routeInfo(recipe);
    if (!info) return;

    routes.set(info.configId, info);
    await publish();
}

export async function removeRoute(recipe: Recipe): Promise<void> {
    const configId = configIdOf(recipe);
    if (!configId || !routes.delete(configId)) return;

    await publish();
}

export async function reconcileRoutes(runningConfigIds: string[]): Promise<void> {
    const keep = new Set(runningConfigIds);
    let changed = false;

    for (const configId of [...routes.keys()]) {
        if (keep.has(configId)) continue;

        routes.delete(configId);
        changed = true;
    }

    if (changed) await publish();
}
