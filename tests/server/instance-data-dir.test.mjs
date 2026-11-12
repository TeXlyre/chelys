// tests/server/instance-data-dir.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(
	path.join(os.tmpdir(), 'chelys-instance-data-dir-'),
);
process.env.CHELYS_DATA_DIR = directory;
const { dataDir, socketPath } = await import('../../server/data.mjs');
const { invoke } = await import('../../server/adapters/core.mjs');
const { appDataDir } = await import('../../server/adapters/path.mjs');

test('native instance data directory and Tauri app-data adapter resolve to the same headless profile', async () => {
	assert.equal(await invoke('instance_data_dir'), directory);
	assert.equal(await appDataDir(), directory);
	assert.equal(dataDir, directory);
	if (process.platform !== 'win32')
		assert.equal(socketPath, path.join(directory, 'chelys.sock'));
});

test('shared recipe store path can be created and read through existing headless filesystem methods', async () => {
	const recipeFile = await invoke('path_join', {
		parts: [await invoke('instance_data_dir'), 'chelys-recipes.json'],
	});
	assert.equal(recipeFile, path.join(directory, 'chelys-recipes.json'));
	assert.equal(await invoke('fs_exists', { path: recipeFile }), false);
	const contents = Array.from(
		new TextEncoder().encode('[{"id":"test-recipe"}]'),
	);
	await invoke('fs_write', { path: recipeFile, contents });
	assert.equal(await invoke('fs_exists', { path: recipeFile }), true);
	assert.equal(
		new TextDecoder().decode(
			Uint8Array.from(await invoke('fs_read', { path: recipeFile })),
		),
		'[{"id":"test-recipe"}]',
	);
	assert.equal(
		fs.existsSync(path.join(directory, 'chelys-recipes.json')),
		true,
	);
});

test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
