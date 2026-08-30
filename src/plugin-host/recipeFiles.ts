// src/plugin-host/recipeFiles.ts
import { readFile } from '@tauri-apps/plugin-fs';

export const isRecipeUrl = (value?: string): boolean =>
	!!value && /^https?:\/\//i.test(value);

export const normalizeRecipeFilePath = (rawPath: string): string => {
	const path = rawPath.trim().replace(/^\.\//, '');

	if (
		!path ||
		path.startsWith('/') ||
		path.startsWith('\\') ||
		path.includes('\\') ||
		/^[a-zA-Z]:/.test(path) ||
		!path
			.split('/')
			.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
	) {
		throw new Error(`Unsafe recipe file path "${rawPath}"`);
	}

	return path;
};

export async function fetchRecipeFileBytes(
	source: string,
	rawPath: string,
): Promise<Uint8Array> {
	const path = normalizeRecipeFilePath(rawPath);

	if (isRecipeUrl(source)) {
		const base = source.replace(/\/?$/, '/');
		const response = await fetch(base + path, { cache: 'no-cache' });
		if (!response.ok) {
			throw new Error(`Could not fetch "${path}" (${response.status})`);
		}
		return new Uint8Array(await response.arrayBuffer());
	}

	const base = source.replace(/[/\\]?$/, '/');
	return readFile(base + path);
}

export const decodeRecipeText = (bytes: Uint8Array): string | null => {
	if (bytes.includes(0)) return null;

	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
};
