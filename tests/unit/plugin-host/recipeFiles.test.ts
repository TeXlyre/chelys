import { describe, expect, it } from 'vitest';
import {
	decodeRecipeText,
	normalizeRecipeFilePath,
} from '@src/plugin-host/recipeFiles';

describe('recipe file paths', () => {
	it('normalizes safe relative paths without changing their location', () => {
		expect(normalizeRecipeFilePath('./assets/config.json')).toBe(
			'assets/config.json',
		);
		expect(normalizeRecipeFilePath(' scripts/start.sh ')).toBe(
			'scripts/start.sh',
		);
	});

	it.each([
		'',
		'.',
		'..',
		'../secret',
		'assets/../secret',
		'assets/./config.json',
		'assets//config.json',
		'/etc/passwd',
		'\\\\server\\share',
		'assets\\config.json',
		'C:/Windows/system.ini',
	])('rejects unsafe path %j before materialization', (path) => {
		expect(() => normalizeRecipeFilePath(path)).toThrow('Unsafe recipe file path');
	});
});

describe('recipe text decoding', () => {
	it('decodes valid UTF-8 recipe assets', () => {
		const bytes = new TextEncoder().encode('hello π 世界');

		expect(decodeRecipeText(bytes)).toBe('hello π 世界');
	});

	it('treats NUL-containing or invalid UTF-8 data as binary', () => {
		expect(decodeRecipeText(Uint8Array.of(0x61, 0x00, 0x62))).toBeNull();
		expect(decodeRecipeText(Uint8Array.of(0xc3, 0x28))).toBeNull();
	});
});
