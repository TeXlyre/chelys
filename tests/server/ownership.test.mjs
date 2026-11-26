// tests/server/ownership.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chelys-owner-test-'));
process.env.CHELYS_DATA_DIR = directory;
const { ownerPreference, withStartupClaim } = await import(
	'../../server/ownership.mjs'
);
const claim = path.join(directory, '.instance-startup.lock');

const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));

test('owner defaults to automatic and reads desktop/headless preferences', () => {
	assert.equal(ownerPreference(), 'automatic');
	for (const mode of ['desktop', 'headless', 'automatic']) {
		fs.writeFileSync(
			path.join(directory, 'instance-owner.json'),
			JSON.stringify({ mode }),
		);
		assert.equal(ownerPreference(), mode);
	}
	fs.writeFileSync(
		path.join(directory, 'instance-owner.json'),
		JSON.stringify({ mode: 'arbitrary' }),
	);
	assert.throws(ownerPreference, /Invalid profile owner/);
	fs.writeFileSync(path.join(directory, 'instance-owner.json'), '{bad-json');
	assert.throws(ownerPreference, /Invalid instance-owner.json/);
	fs.unlinkSync(path.join(directory, 'instance-owner.json'));
});

test('startup claim serializes concurrent socket owners and clears on failure', async () => {
	const events = [];
	const first = withStartupClaim(async () => {
		events.push('first entered');
		await sleep(80);
		events.push('first left');
	});
	await sleep(10);
	const second = withStartupClaim(async () => events.push('second entered'));
	await Promise.all([first, second]);
	assert.deepEqual(events, ['first entered', 'first left', 'second entered']);
	assert.equal(fs.existsSync(claim), false);
	await assert.rejects(
		withStartupClaim(async () => {
			throw new Error('startup broke');
		}),
		/startup broke/,
	);
	assert.equal(fs.existsSync(claim), false);
});

test('stale startup claim can be recovered after a crash', async () => {
	fs.writeFileSync(claim, '999999\n', { mode: 0o600 });
	const past = new Date(Date.now() - 45_000);
	fs.utimesSync(claim, past, past);
	await withStartupClaim(async () => assert.equal(fs.existsSync(claim), true));
	assert.equal(fs.existsSync(claim), false);
});

test('headless-only CLI can recover the owner choice without a running daemon', () => {
	const env = { ...process.env, CHELYS_DATA_DIR: directory };
	const run = (args) =>
		spawnSync(process.execPath, [path.join(root, 'server/cli.mjs'), ...args], {
			encoding: 'utf8',
			env,
			timeout: 5_000,
		});
	for (const mode of ['desktop', 'headless', 'automatic']) {
		const result = run(['runtime', 'preference', mode]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(ownerPreference(), mode);
	}
	assert.equal(run(['runtime', 'preference', 'invalid']).status, 1);
	assert.equal(ownerPreference(), 'automatic');
});

test('manual desktop mode rejects foreground and detached headless startup', () => {
	fs.writeFileSync(
		path.join(directory, 'instance-owner.json'),
		'{"mode":"desktop"}',
	);
	for (const args of [['serve'], ['serve', '--detach']]) {
		const result = spawnSync(
			process.execPath,
			[path.join(root, 'server/cli.mjs'), ...args],
			{
				encoding: 'utf8',
				env: { ...process.env, CHELYS_DATA_DIR: directory },
				timeout: 5_000,
			},
		);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Desktop ownership is selected/);
	}
});

test('headless implementation and desktop settings use the same preference path and choice grammar', () => {
	const source = fs.readFileSync(
		path.join(root, 'src-tauri/src/ownership.rs'),
		'utf8',
	);
	assert.match(source, /instance-owner\.json/);
	assert.match(source, /\.instance-startup\.lock/);
	assert.match(source, /Automatic, Desktop, Headless/);
	const ui = fs.readFileSync(
		path.join(root, 'src/components/settings/BackendOwnershipSection.tsx'),
		'utf8',
	);
	assert.match(ui, /Automatic \(recommended\)/);
	assert.match(ui, /Headless daemon/);
	assert.match(ui, /Desktop-managed/);
});

test('offline runtime show reports the saved choice without a backend', () => {
	const env = { ...process.env, CHELYS_DATA_DIR: directory };
	const run = (...args) =>
		spawnSync(process.execPath, [path.join(root, 'server/cli.mjs'), ...args], {
			encoding: 'utf8',
			env,
			timeout: 5_000,
		});
	assert.equal(run('runtime', 'preference', 'desktop').status, 0);
	const result = run('runtime', 'show', '--json');
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), {
		preference: 'desktop',
		status: 'stopped',
		kind: null,
		pid: null,
	});
	assert.equal(run('runtime', 'preference', 'automatic').status, 0);
});

test('runtime stop is safe when the backend is already offline', () => {
	const result = spawnSync(
		process.execPath,
		[path.join(root, 'server/cli.mjs'), 'runtime', 'stop', '--json'],
		{
			encoding: 'utf8',
			env: { ...process.env, CHELYS_DATA_DIR: directory },
			timeout: 5_000,
		},
	);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), {
		stopping: false,
		message: 'Backend already stopped',
	});
});

test('lifecycle stop is exposed only through local control and Settings', () => {
	const server = fs.readFileSync(path.join(root, 'server/daemon.mjs'), 'utf8');
	const settings = fs.readFileSync(
		path.join(root, 'src/components/settings/BackendOwnershipSection.tsx'),
		'utf8',
	);
	const native = fs.readFileSync(
		path.join(root, 'src-tauri/src/instance.rs'),
		'utf8',
	);
	assert.match(server, /origin\.transport === 'local'/);
	assert.match(server, /request\.method === 'instance\.shutdown'/);
	assert.match(settings, /instance_restart/);
	assert.match(native, /pub async fn instance_restart/);
});

test('corrupt preference can be overwritten offline using the CLI', () => {
	const file = path.join(directory, 'instance-owner.json');
	fs.writeFileSync(file, 'not JSON');
	const result = spawnSync(
		process.execPath,
		[path.join(root, 'server/cli.mjs'), 'runtime', 'preference', 'automatic'],
		{
			encoding: 'utf8',
			env: { ...process.env, CHELYS_DATA_DIR: directory },
			timeout: 5_000,
		},
	);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(ownerPreference(), 'automatic');
});

test('desktop launcher can start its own desktop-only backend through the CLI', () => {
	const cli = fs.readFileSync(path.join(root, 'server/cli.mjs'), 'utf8');
	const daemon = fs.readFileSync(path.join(root, 'server/daemon.mjs'), 'utf8');
	assert.match(
		cli,
		/ownerPreference\(\) === 'desktop' && \(process\.env\.CHELYS_DESKTOP_MANAGED !== '1'/,
	);
	assert.match(daemon, /ownerPreference\(\) === 'desktop'/);
});

test('desktop-owned backend is reported accurately and watches its owner', () => {
	const daemon = fs.readFileSync(path.join(root, 'server/daemon.mjs'), 'utf8');
	const native = fs.readFileSync(
		path.join(root, 'src-tauri/src/instance.rs'),
		'utf8',
	);
	assert.match(native, /CHELYS_DESKTOP_PID/);
	assert.match(daemon, /desktopManaged \? 'desktop' : 'headless'/);
	assert.match(daemon, /process\.kill\(desktopPid, 0\)/);
	assert.match(daemon, /shutdown\(\)\.finally\(\(\) => process\.exit\(0\)\)/);
});

test('recovery screen can retry, and has a scrollable layout independent of the app grid', () => {
	const recovery = fs.readFileSync(
		path.join(root, 'src/components/profile/BackendRecovery.tsx'),
		'utf8',
	);
	const css = fs.readFileSync(
		path.join(root, 'src/styles/components/profile.css'),
		'utf8',
	);
	const native = fs.readFileSync(
		path.join(root, 'src-tauri/src/instance.rs'),
		'utf8',
	);
	assert.match(recovery, /instance_retry/);
	assert.match(recovery, /runtime preference automatic/);
	assert.match(css, /\.backend-recovery \{[\s\S]*overflow-y: auto/);
	assert.match(native, /pub async fn instance_retry/);
	assert.match(
		native,
		/Err\(error\) => \(OwnerMode::Automatic, Some\(error\)\)/,
	);
});

test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('runtime controls belong to System settings and share the offline recovery control', () => {
	const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
	const modal = read('src/components/settings/SettingsModal.tsx');
	const recovery = read('src/components/profile/BackendRecovery.tsx');
	const profile = read('src/components/profile/ProfileModal.tsx');
	const runtime = read('src/components/settings/BackendOwnershipSection.tsx');
	assert.match(
		modal,
		/activeCategory === t\('System'\) && activeSubcategory === t\('Runtime'\)/,
	);
	assert.match(modal, /showRuntime && <BackendOwnershipSection/);
	assert.match(modal, /runtimeSearchTerms\.some/);
	assert.match(recovery, /<BackendOwnershipSection compact/);
	assert.doesNotMatch(
		profile,
		/BackgroundServerSection|ProfileOwnershipSection|BackendOwnershipSection/,
	);
	assert.match(
		runtime,
		/invoke<OwnerStatus>\('instance_owner_set', \{ mode \}\)/,
	);
	assert.match(runtime, /invoke\('instance_restart'\)/);
	assert.match(runtime, /window\.location\.reload\(\)/);
	assert.match(runtime, /invoke<string>\('instance_install_cli'\)/);
});

test('OS login registration uses shared setting controls and follows ownership at launch', () => {
	const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
	const runtime = read('src/components/settings/BackendOwnershipSection.tsx');
	assert.doesNotMatch(read('chelys.config.ts'), /startOnBoot/);
	assert.doesNotMatch(
		read('src/settings/registry.ts'),
		/startOnBoot|applyStartOnBoot/,
	);
	assert.doesNotMatch(read('src/utils/systemSettings.ts'), /applyStartOnBoot/);
	assert.match(runtime, /setAutostart\(await isEnabled\(\)\)/);
	assert.match(runtime, /<SettingControl/);
	assert.match(runtime, /disabled: busy \|\| autostart === null/);
	assert.doesNotMatch(
		runtime,
		/if \(mode === 'desktop'\)|next && current\.preference/,
	);
	const native = read('src-tauri/src/lib.rs');
	const main = read('src-tauri/src/main.rs');
	assert.match(native, /Some\(vec!\["--autostart"\]\)/);
	assert.match(
		native,
		/credential_directory\(\)[\s\S]*?ownership::read\(&directory\)/,
	);
	assert.match(native, /mode != ownership::OwnerMode::Desktop/);
	assert.match(
		main,
		/Some\("--autostart"\)[\s\S]*?autostart_headless\(\)[\s\S]*?run_cli\(vec!\["--headless"\.into\(\)\]\)/,
	);
	assert.match(
		read('src/settings/registry.ts'),
		/Only desktop-managed backends stop when the desktop quits/,
	);
});
