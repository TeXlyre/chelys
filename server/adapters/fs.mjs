// server/adapters/fs.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../data.mjs';

export const BaseDirectory = { AppData: 22 };
function resolve(file, options = {}) {
	if (options.baseDir === BaseDirectory.AppData) {
		const full = path.resolve(dataDir, file);
		if (full !== dataDir && !full.startsWith(dataDir + path.sep))
			throw new Error('Path escapes Chelys data directory');
		return full;
	}
	return path.resolve(file);
}
export const mkdir = (file, options) =>
	fs.mkdir(resolve(file, options), { recursive: options?.recursive ?? false });
export const readFile = (file, options) => fs.readFile(resolve(file, options));
export const readTextFile = (file, options) =>
	fs.readFile(resolve(file, options), 'utf8');
export async function writeFile(file, bytes, options) {
	const full = resolve(file, options);
	await fs.mkdir(path.dirname(full), { recursive: true });
	await fs.writeFile(full, bytes);
}
export async function writeTextFile(file, text, options) {
	return writeFile(file, new TextEncoder().encode(text), options);
}
export async function readDir(file, options) {
	const items = await fs.readdir(resolve(file, options), {
		withFileTypes: true,
	});
	return items.map((item) => ({
		name: item.name,
		isDirectory: item.isDirectory(),
		isFile: item.isFile(),
		isSymlink: item.isSymbolicLink(),
	}));
}
