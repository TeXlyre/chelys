// server/adapters/path.mjs
import path from 'node:path';
import { dataDir, ensureDataDir } from '../data.mjs';
export async function appDataDir() {
	ensureDataDir();
	return dataDir;
}

export async function join(...parts) {
	return path.join(...parts);
}
