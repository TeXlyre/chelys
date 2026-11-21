// tests/server/unified-control.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (filename) => fs.readFileSync(path.join(root, filename), 'utf8');

test('full native dashboard is used for the daemon-attached desktop', () => {
	const entry = read('src/main.tsx');
	assert.match(entry, /<App\s*\/>/);
	assert.doesNotMatch(entry, /AttachedDashboard/);
	assert.equal(
		fs.existsSync(path.join(root, 'src/components/app/AttachedDashboard.tsx')),
		false,
	);
	assert.match(read('src/components/app/AppRouter.tsx'), /<DashboardApp\s*\/>/);
});

test('recipe forms, registry, processes and variable editing share local RPC', () => {
	const provider = read('src/contexts/PluginHostContext.tsx');
	for (const method of [
		'recipes.snapshot',
		'recipes.save',
		'recipes.install',
		'recipes.run',
		'recipes.stop',
		'recipes.uninstall',
		'recipes.remove',
		'recipes.cancelInstall',
		'recipes.registry.add',
		'recipes.registry.refresh',
		'recipes.variables.set',
		'recipes.engine.set',
	])
		assert.ok(
			provider.includes(`'${method}'`),
			`Missing unified operation ${method}`,
		);
	assert.doesNotMatch(provider, /recipeManager|\.installFromRegistry\(/);
	assert.match(read('src/control/localClient.ts'), /instance_rpc/);
	assert.match(read('src/control/commands.ts'), /case 'recipes.save':/);
	assert.match(read('src/control/commands.ts'), /recipe\.id !== ''/);
});

test('account key and room transitions are backend-owned and do not return passwords to the renderer', () => {
	const room = read('src/contexts/RoomContext.tsx');
	const daemon = read('server/daemon.mjs');
	assert.doesNotMatch(
		room,
		/load_credentials|deriveIdentity|migrateUserStorage/,
	);
	assert.match(room, /account\.credentials/);
	assert.match(daemon, /credentials: \(\) =>\s*currentCredentials\s*\?\s*\{/);
	assert.match(daemon, /activateCredentials\(credentials, migrateRoomData\)/);
	assert.match(
		read('src/runtime/lifecycle.ts'),
		/beforeStart\?\.\(credentials\.username, identity\.roomId\)/,
	);
	assert.doesNotMatch(
		read('src-tauri/src/lib.rs'),
		/fn (?:load|save|clear)_credentials\(/,
	);
});

test('Tauri holds UI-only functions and proxies all recipe state through the daemon', () => {
	const native = read('src-tauri/src/lib.rs');
	const instance = read('src-tauri/src/instance.rs');
	assert.match(instance, /command\(&state\.socket, &method, params\)\s*\.await/);
	assert.match(instance, /spawn_backend/);
	assert.doesNotMatch(
		instance,
		/instance_storage_sync|instance_storage_mutate/,
	);
	assert.doesNotMatch(
		native,
		/instance::instance_reply|process_spawn|traefik_start_route_server|rtc_create_peer/,
	);
	for (const filename of [
		'src-tauri/src/process_supervisor.rs',
		'src-tauri/src/webrtc_bridge.rs',
		'src-tauri/src/route_server.rs',
	]) {
		assert.equal(
			fs.existsSync(path.join(root, filename)),
			false,
			`${filename} must be retired`,
		);
	}
});

test('presence and profile storage are backend-owned without a second renderer transport', () => {
	assert.match(
		read('src/components/plugin-host/RendezvousAvatars.tsx'),
		/recipes\.collaborators/,
	);
	assert.doesNotMatch(
		read('src/components/plugin-host/RendezvousAvatars.tsx'),
		/acquireRendezvous/,
	);
	assert.match(
		read('src/control/commands.ts'),
		/case 'recipes\.collaborators':/,
	);
	assert.match(read('src/runtime/storageMirror.ts'), /storage\.sync/);
	assert.match(read('src/runtime/storageMirror.ts'), /storage\.mutate/);
	assert.match(
		read('src/contexts/SettingsContext.tsx'),
		/chelys-storage-updated/,
	);
});

test('rich renderer commands stay local-only and remote commands retain permission checks', () => {
	const control = read('src/control/commands.ts');
	assert.match(control, /const permission = requiredPermission\(method, p\);/);
	assert.match(control, /if \(!permission\) throw deniedRemote/);
	for (const command of [
		'storage.sync',
		'storage.mutate',
		'recipes.snapshot',
		'recipes.save',
		'account.credentials',
		'recipes.collaborators',
	]) {
		assert.ok(control.includes(`case '${command}':`));
		assert.doesNotMatch(
			control.split('const PERMISSION_BY_METHOD:')[1].split('};')[0],
			new RegExp(`'${command.replaceAll('.', '\\.')}':`),
			`${command} must not be remotable`,
		);
	}
});
