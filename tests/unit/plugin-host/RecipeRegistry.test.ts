// tests/unit/plugin-host/RecipeRegistry.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recipeCategory } from '@src/plugin-host/recipeCategory';
import { recipeRegistry } from '@src/plugin-host/RecipeRegistry';
import type { RegistryEntry } from '@src/plugin-host/types';

const jsonResponse = (value: unknown, status = 200): Response =>
	new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json' },
	});

beforeEach(() => {
	recipeRegistry.setBaseUrl('https://registry.test/api/recipes.json');
	recipeRegistry.clearCache();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('recipe registry', () => {
	it('normalizes versioned and legacy entries into a stable registry model', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse({
					version: '1',
					categories: [
						{
							id: 'lsp',
							recipes: [
								{
									id: 'versioned',
									type: 'lsp',
									name: 'Versioned',
									category: ' Custom category ',
									manifestUrl: 'https://registry.test/versioned/latest.json',
									versions: [
										{
											version: '2.0.0',
											manifestUrl:
												'https://registry.test/versioned/2.0.0.json',
										},
									],
								},
								{
									id: 'legacy',
									type: 'typesetter',
									name: 'Legacy',
									version: '1.4.0',
									manifestUrl: 'https://registry.test/legacy/recipe.json',
								},
							],
						},
					],
				}),
			),
		);

		const entries = await recipeRegistry.list(false);

		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			id: 'versioned',
			category: 'Custom category',
			version: '2.0.0',
			versions: [
				{
					version: '2.0.0',
					manifestUrl: 'https://registry.test/versioned/2.0.0.json',
				},
			],
			tags: [],
		});
		expect(recipeCategory(entries[1], () => 'Typesetter')).toBe('Typesetter');
		expect(recipeCategory(entries[0], () => 'Language Server')).toBe('Custom category');
		expect(entries[1]?.versions).toEqual([
			{
				version: '1.4.0',
				manifestUrl: 'https://registry.test/legacy/recipe.json',
			},
		]);
	});

	it('fetches the selected manifest and materializes its relative Dockerfile', async () => {
		const entry: RegistryEntry = {
			id: 'ltex',
			type: 'lsp',
			name: 'LTeX',
			category: 'Latest category',
			version: '2.0.0',
			manifestUrl: 'https://registry.test/ltex/2.0.0/recipe.json',
			versions: [
				{
					version: '1.0.0',
					manifestUrl: 'https://registry.test/ltex/1.0.0/recipe.json',
				},
				{
					version: '2.0.0',
					manifestUrl: 'https://registry.test/ltex/2.0.0/recipe.json',
				},
			],
		};
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url === 'https://registry.test/ltex/1.0.0/recipe.json') {
				return jsonResponse({
					id: '',
					type: 'lsp',
					name: 'LTeX',
					version: '1.0.0',
					env: {},
					typeConfig: {},
					modes: [
						{
							kind: 'docker',
							image: 'example/ltex:1.0.0',
							buildSteps: [],
							runArgs: [],
							dockerfileUrl: './Dockerfile',
						},
					],
				});
			}
			if (url === 'https://registry.test/ltex/1.0.0/Dockerfile') {
				return new Response('FROM alpine\nRUN echo ltex\n');
			}
			throw new Error(`unexpected URL: ${url}`);
		});
		vi.stubGlobal('fetch', fetchMock);

		const recipe = await recipeRegistry.fetchRecipe(entry, '1.0.0');
		const docker = recipe.modes[0];

		expect(recipe.id).toBe('ltex');
		expect(recipe.version).toBe('1.0.0');
		expect(recipe.category).toBeUndefined();
		expect(recipe.source).toBe('registry');
		expect(recipe.sourceUrl).toBe('https://registry.test/ltex/1.0.0/');
		expect(docker.kind).toBe('docker');
		if (docker.kind !== 'docker') throw new Error('expected docker mode');
		expect(docker.dockerfile).toBe('FROM alpine\nRUN echo ltex\n');
	});
});

it('rejects unknown manifest versions without silently installing the latest', async () => {
	const fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
	await expect(recipeRegistry.fetchRecipe({
		id: 'garage-storage', type: 'storage', name: 'Garage',
		manifestUrl: 'https://registry.test/garage/latest.json',
		versions: [{ version: '2.4.1', manifestUrl: 'https://registry.test/garage/2.4.1/recipe.json' }],
	}, '0.0.0')).rejects.toThrow('Recipe version not found');
	expect(fetchMock).not.toHaveBeenCalled();
});

it('preserves manifest categories, falls back to the current registry entry, and ignores invalid categories', async () => {
    const entry: RegistryEntry = { id: 'example', type: 'endpoint', name: 'Example', category: 'Computer Vision', version: '1.0.0', manifestUrl: 'https://registry.test/example/recipe.json' };
    const manifest = { id: entry.id, type: entry.type, name: entry.name, env: {}, modes: [{ kind: 'connect' }], typeConfig: {} };
    for (const [category, expected] of [[undefined, 'Computer Vision'], [' New category ', 'New category'], [42, 'Computer Vision']]) {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...manifest, category })));
        expect((await recipeRegistry.fetchRecipe(entry)).category).toBe(expected);
    }
});
