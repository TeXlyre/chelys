// src/plugin-host/traefikRouting.ts
import { getStoredSetting } from '../config';

interface TransportConfig {
    transportUrl?: unknown;
    transportType?: unknown;
    configId?: unknown;
}

interface ParsedUrl {
    scheme: string;
    host: string;
    port: string;
    path: string;
}

export const safeName = (configId: string): string =>
    configId.replace(/[^a-zA-Z0-9_.-]/g, '-');

const parseUrl = (value: string): ParsedUrl => {
    const schemeMatch = value.match(/^([a-z]+):\/\//i);
    const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : '';
    const rest = schemeMatch ? value.slice(schemeMatch[0].length) : value;

    const pathStart = rest.indexOf('/');
    const authority = pathStart === -1 ? rest : rest.slice(0, pathStart);
    const path = pathStart === -1 ? '' : rest.slice(pathStart);

    const portStart = authority.indexOf(':');
    const host = portStart === -1 ? authority : authority.slice(0, portStart);
    const port = portStart === -1 ? '' : authority.slice(portStart + 1);

    return { scheme, host, port, path };
};

const toTransportScheme = (scheme: string, fallback: string): string => {
    if (scheme === 'https' || scheme === 'wss') return 'wss';
    if (scheme === 'http' || scheme === 'ws') return 'ws';
    return fallback || 'ws';
};

export function rewriteTransportUrl(config: TransportConfig): string | undefined {
    const url = typeof config.transportUrl === 'string' ? config.transportUrl : undefined;
    if (!url) return url;

    if (config.transportType === 'webrtc') return url;

    const original = parseUrl(url);

    if (getStoredSetting<boolean>('traefikEnabled')) {
        const base = parseUrl(getStoredSetting<string>('traefikBaseUrl').trim());
        if (!base.host) return url;

        const scheme = toTransportScheme(base.scheme, toTransportScheme(original.scheme, 'ws'));
        const authority = base.port ? `${base.host}:${base.port}` : base.host;
        const id =
            typeof config.configId === 'string' ? safeName(config.configId) : '';
        const suffix = id ? `/${id}` : original.path;

        return `${scheme}://${authority}${suffix}`;
    }

    const host = getStoredSetting<string>('serviceHost').trim();
    if (!host) return url;

    const scheme = original.scheme || 'ws';
    const authority = original.port ? `${host}:${original.port}` : host;

    return `${scheme}://${authority}${original.path}`;
}
