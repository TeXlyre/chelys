// server/data.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const explicitDataDir = process.env.CHELYS_DATA_DIR;
const xdgHome = process.env.XDG_DATA_HOME;
if (explicitDataDir && !path.isAbsolute(explicitDataDir))
	throw new Error('CHELYS_DATA_DIR must be an absolute path');
if (!explicitDataDir && xdgHome && !path.isAbsolute(xdgHome))
	throw new Error('XDG_DATA_HOME must be an absolute path');
export const dataDir = path.resolve(
	explicitDataDir ||
		path.join(xdgHome || path.join(os.homedir(), '.local', 'share'), 'chelys'),
);

export const socketPath =
	process.platform === 'win32'
		? `\\\\.\\pipe\\chelys-${createHash('sha256').update(dataDir).digest('hex').slice(0, 20)}`
		: path.join(dataDir, 'chelys.sock');
const storageFile = path.join(dataDir, 'storage.json');
export const hasPersistentStorage = () => fs.existsSync(storageFile);
const autostartFile = path.join(dataDir, 'active-recipes.json');

export function ensureDataDir() {
	fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	if (process.platform !== 'win32') fs.chmodSync(dataDir, 0o700);
}
export function readJson(file, fallback) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (error) {
		if (error.code === 'ENOENT') return fallback;
		throw new Error(`Invalid JSON in ${file}: ${error.message}`);
	}
}
export function writeJson(file, data) {
	ensureDataDir();
	const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(data, null, 2), {
			mode: 0o600,
			flag: 'wx',
		});
		fs.renameSync(tmp, file);
		fs.chmodSync(file, 0o600);
	} finally {
		try {
			fs.unlinkSync(tmp);
		} catch {}
	}
}
export function createLocalStorage() {
	const data = Object.assign(Object.create(null), readJson(storageFile, {}));
	if (!data || typeof data !== 'object' || Array.isArray(data))
		throw new Error('Invalid Chelys local storage');
	const save = () => writeJson(storageFile, data);
	return {
		get length() {
			return Object.keys(data).length;
		},
		key(index) {
			return Object.keys(data)[index] ?? null;
		},
		getItem(key) {
			return Object.hasOwn(data, String(key)) ? data[String(key)] : null;
		},
		setItem(key, value) {
			data[String(key)] = String(value);
			save();
		},
		removeItem(key) {
			delete data[String(key)];
			save();
		},
		clear() {
			for (const key of Object.keys(data)) delete data[key];
			save();
		},
	};
}
export function activeRecipes() {
	const stored = readJson(autostartFile, []);
	return new Set(
		Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [],
	);
}
export function saveActiveRecipes(ids) {
	writeJson(autostartFile, [...ids].sort());
}

export function fallbackCredentialPath() {
	const id = process.env.CHELYS_CREDENTIAL_ID || 'default';
	if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(id)) {
		throw new Error('Invalid CHELYS_CREDENTIAL_ID');
	}
	return path.join(
		dataDir,
		id === 'default' ? 'account.json' : `account.${id}.json`,
	);
}
