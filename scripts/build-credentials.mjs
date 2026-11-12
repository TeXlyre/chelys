// scripts/build-credentials.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = path.join(root, 'native', 'credentials', 'Cargo.toml');
const binaryName =
	process.platform === 'win32'
		? 'chelys-credentials.exe'
		: 'chelys-credentials';
const result = spawnSync(
	'cargo',
	['build', '--release', '--manifest-path', manifest],
	{
		stdio: 'inherit',
		windowsHide: true,
	},
);
if (result.error)
	throw new Error(
		`Cargo is required to build the native OS keychain helper: ${result.error.message}`,
	);
if (result.status !== 0) process.exit(result.status ?? 1);
const from = path.join(
	root,
	'native',
	'credentials',
	'target',
	'release',
	binaryName,
);
const to = path.join(root, 'server', 'bin', binaryName);
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);
if (process.platform !== 'win32') fs.chmodSync(to, 0o755);
console.log('Built native Chelys OS credential helper:', to);
