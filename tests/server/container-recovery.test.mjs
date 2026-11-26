// tests/server/container-recovery.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager = fs.readFileSync(
	new URL('../../src/plugin-host/RecipeManager.ts', import.meta.url),
	'utf8',
);
const daemon = fs.readFileSync(
	new URL('../../server/daemon.mjs', import.meta.url),
	'utf8',
);
const tauri = fs.readFileSync(
	new URL('../../src-tauri/src/lib.rs', import.meta.url),
	'utf8',
);

test('recipe start reuses an existing running container or attaches to a stopped one', () => {
	assert.match(manager, /existingContainer === 'running'/);
	assert.match(manager, /\['start', '--attach', containerName\(recipeId\)\]/);
	assert.match(manager, /existingContainer === 'stopped'\s*\?/);
	assert.match(manager, /this\.starting\.get\(recipeId\)/);
	assert.match(manager, /await this\.starting\.get\(recipeId\)/);
	assert.doesNotMatch(manager, /'--replace'/);
});

test('active recipe intent survives backend shutdown and restores through the same command path', () => {
	assert.match(daemon, /const desired = activeRecipes\(\)/);
	assert.match(
		daemon,
		/await chelysControl\.execute\(\{ method: 'recipes\.run'/,
	);
	assert.match(daemon, /saveActiveRecipes\(desired\)/);
});

test('Tauri tray mode hides a window and only intercepts close with a tray available', () => {
	assert.match(tauri, /CloseRequested\s*\{ api, \.\. \}/);
	assert.match(tauri, /tray_by_id\("main"\)\.is_some\(\)/);
	assert.match(tauri, /window\.hide\(\)\.is_ok\(\)/);
	assert.match(tauri, /api\.prevent_close\(\)/);
});
