// src/plugins/lsp/shared.ts
import { nanoid } from 'nanoid';

import type { TransportBinding } from '../../plugin-host/bridgeHooks';
import type { Recipe } from '../../plugin-host/types';
import type { LspConfigBlock, LspTypeConfig } from './types';

export const LSP_TYPE = 'lsp';

export interface LspRecipeModule {
    recipe: Recipe;
}

function toBlockTransport(
    config: LspTypeConfig,
): LspConfigBlock['transportConfig'] {
    const type = config.transportType ?? 'websocket';

    if (type === 'webrtc') {
        return {
            type,
            ...(config.transportRoomId ? { roomId: config.transportRoomId } : {}),
            ...(config.signalingServers?.length
                ? { signaling: config.signalingServers }
                : {}),
            contentLength: config.contentLength,
        };
    }

    return {
        type,
        url: config.transportUrl,
        contentLength: config.contentLength,
    };
}

export function recipeToConfigBlock(
    recipe: Recipe,
    enabled: boolean,
): LspConfigBlock {
    const config = recipe.typeConfig as unknown as LspTypeConfig;
    return {
        id: config.configId,
        name: recipe.name,
        enabled,
        ...(recipe.icon ? { icon: recipe.icon } : {}),
        fileExtensions: config.fileExtensions,
        languageIdMap: config.languageIdMap,
        transportConfig: toBlockTransport(config),
        clientConfig: config.clientConfig,
    };
}

export function readLspTransport(recipe: Recipe): TransportBinding | null {
    const config = recipe.typeConfig as unknown as LspTypeConfig;
    if (!config) return null;

    return {
        configId: config.configId,
        transport: {
            type: config.transportType ?? 'websocket',
            url: config.transportUrl,
            roomId: config.transportRoomId,
            signaling: config.signalingServers,
            contentLength: config.contentLength,
        },
    };
}

export function parseLspImport(raw: string): Recipe {
    const parsed = JSON.parse(raw);
    const block: LspConfigBlock = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!block || typeof block !== 'object') {
        throw new Error('Paste a TeXlyre LSP config block or recipe JSON');
    }

    const transport = block.transportConfig ?? {
        type: 'websocket' as const,
        url: 'ws://localhost:7020',
        contentLength: false,
    };

    const typeConfig: LspTypeConfig = {
        configId: block.id || nanoid(),
        fileExtensions: block.fileExtensions ?? [],
        languageIdMap: block.languageIdMap ?? {},
        transportType: transport.type ?? 'websocket',
        transportUrl: transport.url ?? 'ws://localhost:7020',
        transportRoomId: transport.roomId,
        signalingServers: transport.signaling,
        contentLength: transport.contentLength ?? false,
        clientConfig: block.clientConfig ?? '{}',
    };

    return {
        id: nanoid(),
        type: LSP_TYPE,
        name: block.name || block.id || 'Imported LSP',
        env: {},
        modes: [{ kind: 'connect' }],
        selectedMode: 'connect',
        typeConfig: typeConfig as unknown as Record<string, unknown>,
    };
}
