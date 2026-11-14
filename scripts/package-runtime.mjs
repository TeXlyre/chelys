// scripts/package-runtime.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureServerDependencies } from './server-dependencies.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const target =
	process.env.TAURI_ENV_TARGET_TRIPLE ||
	process.env.CHELYS_TARGET ||
	{
		linux: {
			x64: 'x86_64-unknown-linux-gnu',
			arm64: 'aarch64-unknown-linux-gnu',
		},
		darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
		win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
	}[process.platform]?.[process.arch];
const platform = process.platform;
const mode = process.argv[2];
if (!['--desktop', '--server'].includes(mode))
	throw new Error('Use --desktop or --server');
if (!target) throw new Error('Unsupported build platform');
const expected = target.startsWith('aarch64-') ? 'arm64' : 'x64';
if (expected !== process.arch)
	throw new Error(
		`Node.js architecture ${process.arch} does not match ${target}. Use a native build runner.`,
	);
if (
	(target.includes('windows')
		? 'win32'
		: target.includes('apple')
			? 'darwin'
			: 'linux') !== platform
) {
	throw new Error(`Node.js platform ${platform} does not match ${target}`);
}
const binary = platform === 'win32' ? '.exe' : '';
const rootRuntime = path.join(root, 'release', 'runtime');
const helper = path.join(root, 'server', 'bin', `chelys-credentials${binary}`);
const built = path.join(root, 'server', 'dist', 'runtime.mjs');
if (!fs.existsSync(built) || !fs.existsSync(helper))
	throw new Error(
		'Build the server runtime and credential helper first: npm run build:server',
	);
ensureServerDependencies(path.join(root, 'server'));
fs.rmSync(rootRuntime, { recursive: true, force: true });
fs.mkdirSync(rootRuntime, { recursive: true });
for (const name of ['package.json', 'package-lock.json']) {
	fs.copyFileSync(path.join(root, name), path.join(rootRuntime, name));
}
const install = spawnSync(
	'npm',
	['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
	{
		cwd: rootRuntime,
		stdio: 'inherit',
		shell: platform === 'win32',
	},
);
if (install.error || install.status !== 0)
	throw new Error(
		`Production runtime dependency installation failed: ${install.error?.message || install.status}`,
	);
fs.copyFileSync(process.execPath, path.join(rootRuntime, `node${binary}`));
if (platform !== 'win32') fs.chmodSync(path.join(rootRuntime, 'node'), 0o755);
fs.mkdirSync(path.join(rootRuntime, 'server'), { recursive: true });
for (const item of fs.readdirSync(path.join(root, 'server'))) {
	if (item.endsWith('.mjs') || item === 'package.json') {
		fs.copyFileSync(
			path.join(root, 'server', item),
			path.join(rootRuntime, 'server', item),
		);
	}
}
fs.cpSync(
	path.join(root, 'server', 'dist'),
	path.join(rootRuntime, 'server', 'dist'),
	{ recursive: true },
);
fs.cpSync(
	path.join(root, 'server', 'adapters'),
	path.join(rootRuntime, 'server', 'adapters'),
	{ recursive: true },
);
fs.cpSync(
	path.join(root, 'server', 'node_modules'),
	path.join(rootRuntime, 'server', 'node_modules'),
	{ recursive: true, dereference: true },
);
fs.mkdirSync(path.join(rootRuntime, 'server', 'bin'), { recursive: true });
fs.copyFileSync(
	helper,
	path.join(rootRuntime, 'server', 'bin', path.basename(helper)),
);
if (platform !== 'win32')
	fs.chmodSync(
		path.join(rootRuntime, 'server', 'bin', path.basename(helper)),
		0o755,
	);
const launcherManifest = path.join(root, 'native', 'launcher', 'Cargo.toml');
const result = spawnSync(
	'cargo',
	[
		'build',
		'--release',
		'--manifest-path',
		launcherManifest,
		'--target',
		target,
	],
	{ stdio: 'inherit' },
);
if (result.error || result.status !== 0)
	throw new Error(
		`Cannot build Chelys CLI launcher: ${result.error?.message || result.status}`,
	);
const launcher = path.join(
	root,
	'native',
	'launcher',
	'target',
	target,
	'release',
	`chelys-launcher${binary}`,
);
if (!fs.existsSync(launcher))
	throw new Error(`CLI launcher missing: ${launcher}`);
const sidecar = path.join(
	root,
	'src-tauri',
	'binaries',
	`chelys-runtime-${target}${binary}`,
);
fs.mkdirSync(path.dirname(sidecar), { recursive: true });
fs.copyFileSync(launcher, sidecar);
if (platform !== 'win32') fs.chmodSync(sidecar, 0o755);
if (mode === '--server') {
	const serverDir = path.join(root, 'release', `chelys-server-${target}`);
	fs.rmSync(serverDir, { recursive: true, force: true });
	fs.mkdirSync(serverDir, { recursive: true });
	fs.cpSync(rootRuntime, path.join(serverDir, 'runtime'), { recursive: true });
	fs.copyFileSync(launcher, path.join(serverDir, `chelys${binary}`));
	for (const file of ['HEADLESS.md', 'LICENSE']) {
		fs.copyFileSync(path.join(root, file), path.join(serverDir, file));
	}
	fs.copyFileSync(
		path.join(root, 'server', 'chelys.service'),
		path.join(serverDir, 'chelys.service'),
	);
	if (platform !== 'win32') fs.chmodSync(path.join(serverDir, 'chelys'), 0o755);
	console.log('Headless distribution:', serverDir);
} else {
	console.log('Desktop sidecar:', sidecar);
	console.log('Bundled runtime:', rootRuntime);
}
