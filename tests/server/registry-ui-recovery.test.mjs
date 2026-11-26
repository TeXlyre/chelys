// tests/server/registry-ui-recovery.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('recipe browse category options use the same exclusive-type scope as recipe results', () => {
	const source = read('src/components/plugin-host/RecipeBrowser.tsx');
	assert.match(source, /const scopedEntries = useMemo\(/);
	assert.match(
		source,
		/entries\.filter\(\(entry\) => !exclusiveTypes\.has\(entry\.type\)\)/,
	);
	assert.match(
		source,
		/scopedEntries\.map\(\(entry\) => recipeCategory\(entry, typeLabel\)\)/,
	);
	assert.match(source, /return scopedEntries\.filter\(/);
	assert.doesNotMatch(
		source,
		/new Set\(entries\.map\(\(entry\) => entry\.type\)\)/,
	);
	assert.match(
		source,
		/disabled=\{loadingRegistry\}\s+onClick=\{\(\) => void loadRegistry\(\)\}/,
	);
});

test('backend recovery uses the existing RPC socket with a single startup guard', () => {
	const source = read('src-tauri/src/instance.rs');
	assert.match(source, /recovery: tokio::sync::Mutex<\(\)>/);
	assert.match(source, /state\.recovery\.lock\(\)\.await/);
	assert.match(source, /if !error\.recoverable\(\)/);
	assert.match(
		source,
		/tokio::task::spawn_blocking\(move \|\| \{[\s\S]*spawn_backend\(/,
	);
	assert.match(source, /command\(&state\.socket, &method, params\)\s*\.await/);
	assert.doesNotMatch(source, /--replace/);
});

test('transient failures are cleared on account recovery and recipe readiness recovers after restart', () => {
	const room = read('src/contexts/RoomContext.tsx');
	const host = read('src/contexts/PluginHostContext.tsx');
	assert.match(
		room,
		/setCredentialWarning\(status\.credentialStorage\?\.warning \?\? null\)/,
	);
	assert.match(
		host,
		/void refresh\(\)\s*\.then\(\(\) => \{\s*if \(alive\) setIsReady\(true\);\s*\}\)/,
	);
	assert.match(host, /const updatesAvailable = useMemo\(/);
	assert.match(
		host,
		/const entries = await localCommand<RegistryEntry\[\]>\(\s*'recipes\.registry\.refresh',?\s*\);\s*setRegistry\(entries\)/,
	);
	const registryRoutine = host.match(
		/const refreshRegistry = async \(\) => \{([\s\S]*?)\n\t\};/,
	)?.[1];
	assert.ok(registryRoutine);
	assert.doesNotMatch(registryRoutine, /await refresh\(\)/);
});
