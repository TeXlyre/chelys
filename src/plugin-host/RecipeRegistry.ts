// src/plugin-host/RecipeRegistry.ts
import { nanoid } from 'nanoid';

import { getStoredSetting } from '../config';
import type { DockerMode, Recipe, RecipeVersion, RegistryEntry } from './types';

interface RegistryIndex {
    version: string;
    categories: Array<{ id: string; recipes: RegistryEntry[] }>;
}

function normalizeVersions(entry: RegistryEntry): RecipeVersion[] {
    if (Array.isArray(entry.versions) && entry.versions.length > 0) {
        return entry.versions;
    }
    if (entry.manifestUrl) {
        return [{ version: entry.version ?? '', manifestUrl: entry.manifestUrl }];
    }
    return [];
}

class RecipeRegistry {
    private baseUrl: string | null = null;
    private indexCache: RegistryEntry[] | null = null;

    setBaseUrl(url: string): void {
        if (url !== this.baseUrl) {
            this.baseUrl = url;
            this.indexCache = null;
        }
    }

    private getBaseUrl(): string {
        return this.baseUrl ?? getStoredSetting<string>('recipeRegistryUrl');
    }

    clearCache(): void {
        this.indexCache = null;
    }

    async list(useCache = true): Promise<RegistryEntry[]> {
        if (useCache && this.indexCache) return this.indexCache;
        const response = await fetch(this.getBaseUrl(), { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`Registry returned ${response.status}`);
        }
        const data = (await response.json()) as RegistryIndex;
        this.indexCache = Array.isArray(data.categories)
            ? data.categories.flatMap((category) =>
                (category.recipes ?? []).map((entry) => {
                    const versions = normalizeVersions(entry);
                    return {
                        id: entry.id,
                        type: entry.type,
                        name: entry.name,
                        icon: entry.icon,
                        iconUrl: entry.iconUrl,
                        version: entry.version ?? versions[0]?.version,
                        description: entry.description,
                        tags: entry.tags ?? [],
                        manifestUrl: entry.manifestUrl ?? versions[0]?.manifestUrl,
                        versions,
                    };
                }),
            )
            : [];
        return this.indexCache;
    }

    async fetchRecipe(entry: RegistryEntry, version?: string): Promise<Recipe> {
        const manifestUrl = version
            ? (entry.versions?.find((v) => v.version === version)?.manifestUrl ??
                entry.manifestUrl)
            : entry.manifestUrl;
        const response = await fetch(manifestUrl, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`Could not fetch "${entry.name}" (${response.status})`);
        }
        const manifest = (await response.json()) as Recipe;
        const recipe: Recipe = {
            ...manifest,
            id: manifest.id || entry.id || nanoid(),
            icon: manifest.icon ?? entry.icon,
            iconUrl: manifest.iconUrl ?? entry.iconUrl,
            version: manifest.version ?? entry.version,
            source: 'registry',
        };
        await this.inlineIcon(recipe);
        await this.inlineDockerfiles(recipe);
        return recipe;
    }

    private async inlineIcon(recipe: Recipe): Promise<void> {
        if (recipe.icon || !recipe.iconUrl) return;
        try {
            const response = await fetch(recipe.iconUrl, { cache: 'no-cache' });
            if (!response.ok) return;
            const type = response.headers.get('content-type') ?? '';
            if (type.includes('svg') || recipe.iconUrl.endsWith('.svg')) {
                recipe.icon = await response.text();
            } else {
                const buffer = await response.arrayBuffer();
                const base64 = btoa(
                    String.fromCharCode(...new Uint8Array(buffer)),
                );
                recipe.icon = `<img src="data:${type};base64,${base64}" alt="" />`;
            }
        } catch (error) {
            console.warn('[RecipeRegistry] Could not fetch icon:', error);
        }
    }

    private async inlineDockerfiles(recipe: Recipe): Promise<void> {
        for (const mode of recipe.modes) {
            if (mode.kind !== 'docker') continue;
            const docker = mode as DockerMode;
            if (docker.dockerfile || !docker.dockerfileUrl) continue;
            const response = await fetch(docker.dockerfileUrl, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`Could not fetch Dockerfile (${response.status})`);
            }
            docker.dockerfile = await response.text();
        }
    }
}

export const recipeRegistry = new RecipeRegistry();
