// tests/server/distribution.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));

test('desktop and server distributions reuse the same runtime bundler', () => {
	assert.match(
		pkg.scripts['build:desktop'],
		/npm run build:server && node scripts\/package-runtime\.mjs --desktop/,
	);
	assert.match(
		pkg.scripts['package:server'],
		/npm run build:server && node scripts\/package-runtime\.mjs --server/,
	);
	assert.equal(tauri.build.beforeBuildCommand, 'npm run build:desktop');
	assert.deepEqual(tauri.bundle.externalBin, ['binaries/chelys-runtime']);
	assert.equal(tauri.bundle.resources['../release/runtime/'], 'runtime/');
	assert.match(
		read('scripts/package-runtime.mjs'),
		/chelys-server-\$\{target\}/,
	);
});

test('runtime packager reads Cargo launcher output before renaming the Tauri sidecar', () => {
	const cargo = read('native/launcher/Cargo.toml');
	const packager = read('scripts/package-runtime.mjs');
	assert.match(cargo, /^name = "chelys-launcher"$/m);
	assert.match(
		packager,
		/'target',[\s\S]*'release',[\s\S]*`chelys-launcher\$\{binary\}`/,
	);
	assert.match(
		packager,
		/'binaries',[\s\S]*`chelys-runtime-\$\{target\}\$\{binary\}`/,
	);
	assert.match(packager, /fs\.copyFileSync\(launcher, sidecar\)/);
});

test('background runtime is optional and desktop attaches to the existing owner', () => {
	const store = JSON.parse(read('src-tauri/gen/windows/bundle.config.json'));
	assert.equal(store.extensions.startupTask.enabled, false);
	assert.match(read('src-tauri/src/lib.rs'), /Some\(vec!\["--autostart"\]\)/);
	assert.match(read('src/main.tsx'), /if \(mode === 'unavailable'\)/);
	assert.match(read('src/main.tsx'), /<App \/>/);
	assert.match(
		read('server/daemon.mjs'),
		/await reserveSocket\(\);[\s\S]*bootstrapHeadless\(\)/,
	);
});

test('Windows Store advertises CLI execution alias without duplicating profile runtime', () => {
	const manifest = read('src-tauri/gen/windows/AppxManifest.xml.template');
	assert.match(
		manifest,
		/Application Id="ChelysCli" Executable="chelys-runtime\.exe"/,
	);
	assert.match(manifest, /ExecutionAlias Alias="chelys\.exe"/);
	assert.equal((manifest.match(/Alias="chelys\.exe"/g) ?? []).length, 1);
});

test('native launcher and desktop use the same per-user runtime and credential paths', () => {
	const app = read('src-tauri/src/lib.rs');
	const native = read('native/launcher/src/main.rs');
	const server = read('server/data.mjs');
	assert.match(app, /base\.join\("chelys"\)/);
	assert.match(server, /'\.local', 'share'/);
	assert.match(native, /runtime_locator::find_runtime/);
	assert.match(read('native/runtime_locator.rs'), /CHELYS_RUNTIME_DIR/);
	assert.match(app, /mod instance;/);
	assert.match(read('src-tauri/src/instance.rs'), /chelys\.sock/);
});
