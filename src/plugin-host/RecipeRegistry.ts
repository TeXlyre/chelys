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
	private indexCacheKey: string | null = null;

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
        const urls = [...new Set(this.getBaseUrl().split(/[,\n]/).map(url => url.trim()).filter(Boolean))];
        const cacheKey = JSON.stringify(urls);
        if (useCache && this.indexCache && this.indexCacheKey === cacheKey) return this.indexCache;
        if (!urls.length) return [];
        const responses = await Promise.allSettled(urls.map(url => this.fetchIndex(url)));
        const entries = new Map<string, RegistryEntry>();
        let successes = 0;
        for (const response of responses) {
            if (response.status === 'rejected') { console.warn('[RecipeRegistry] Registry unavailable:', response.reason); continue; }
            successes++;
            // The first configured registry owns a given recipe ID.
            for (const entry of response.value) if (!entries.has(entry.id)) entries.set(entry.id, entry);
        }
        if (!successes) throw new Error('No configured recipe registry is reachable');
        const result = [...entries.values()];
        // Do not cache partial failures, so a later refresh can restore them.
        this.indexCache = successes === urls.length ? result : null;
        this.indexCacheKey = cacheKey;
        return result;
    }

    private async fetchIndex(url: string): Promise<RegistryEntry[]> {
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Registry returned ${response.status}`);
        const data = (await response.json()) as RegistryIndex;
        return Array.isArray(data.categories) ? data.categories.flatMap(category => (category.recipes ?? []).map(entry => {
            const versions = normalizeVersions(entry);
            return {
                id: entry.id, type: entry.type, name: entry.name, icon: entry.icon, iconUrl: entry.iconUrl,
                version: entry.version ?? versions[0]?.version, description: entry.description, tags: entry.tags ?? [],
                ...(typeof entry.protocol === 'string' ? { protocol: entry.protocol } : {}),
                ...(Array.isArray(entry.providers) ? { providers: entry.providers } : {}),
                ...(Array.isArray(entry.members) ? { members: entry.members } : {}),
                manifestUrl: entry.manifestUrl ?? versions[0]?.manifestUrl, versions,
            };
        })) : [];
    }

	async fetchRecipe(entry: RegistryEntry, version?: string): Promise<Recipe> {
		const selected = version
			? normalizeVersions(entry).find((item) => item.version === version)
			: null;
		if (version && !selected)
			throw new Error(`Recipe version not found: ${entry.id}@${version}`);
		const manifestUrl = selected?.manifestUrl ?? entry.manifestUrl;
		const response = await fetch(manifestUrl, { cache: 'no-cache' });
		if (!response.ok) {
			throw new Error(`Could not fetch "${entry.name}" (${response.status})`);
		}
		const manifest = (await response.json()) as Recipe;
        if ((manifest.id && manifest.id !== entry.id) || manifest.type !== entry.type) throw new Error('Manifest does not match registry recipe identity or type');
		const recipe: Recipe = {
			...manifest,
			id: manifest.id || entry.id || nanoid(),
			icon: manifest.icon ?? entry.icon,
			iconUrl: manifest.iconUrl ?? entry.iconUrl,
			version: manifest.version ?? version ?? entry.version,
			source: 'registry',
		};
		recipe.sourceUrl = manifestUrl.replace(/[^/]*$/, '');
		await this.inlineIcon(recipe);
		await this.inlineDockerfiles(recipe);
		return recipe;
	}

	private resolveSource(recipe: Recipe, value: string): string {
		if (/^https?:\/\//i.test(value)) return value;
		const base = (recipe.sourceUrl ?? '').replace(/\/?$/, '/');
		return `${base}${value.replace(/^\.\//, '')}`;
	}

	private async inlineIcon(recipe: Recipe): Promise<void> {
		if (recipe.icon || !recipe.iconUrl) return;
		try {
			const iconUrl = this.resolveSource(recipe, recipe.iconUrl);
			const response = await fetch(iconUrl, { cache: 'no-cache' });
			if (!response.ok) return;
			const type = response.headers.get('content-type') ?? '';
			if (type.includes('svg') || iconUrl.endsWith('.svg')) {
				recipe.icon = await response.text();
			} else {
				const buffer = await response.arrayBuffer();
				const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
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
			const dockerfileUrl = this.resolveSource(recipe, docker.dockerfileUrl);
			const response = await fetch(dockerfileUrl, { cache: 'no-cache' });
			if (!response.ok) {
				throw new Error(`Could not fetch Dockerfile (${response.status})`);
			}
			docker.dockerfile = await response.text();
		}
	}
}

export const recipeRegistry = new RecipeRegistry();
