// tests/server/remote-cli.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../server/cli.mjs', import.meta.url));

async function runAgainstMock(args, respond = () => ({ updated: true })) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelys-cli-'));
	const socketPath = path.join(dir, 'chelys.sock');
	const requests = [];
	const server = net.createServer((socket) => {
		let buffer = '';
		socket.setEncoding('utf8');
		socket.on('data', (data) => {
			buffer += data;
			const end = buffer.indexOf('\n');
			if (end < 0) return;
			const request = JSON.parse(buffer.slice(0, end));
			requests.push(request);
			socket.end(
				`${JSON.stringify({ v: 1, id: request.id, ok: true, result: request.method === 'peers.default.get' ? { target: null } : respond(request) })}\n`,
			);
		});
	});
	try {
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(socketPath, resolve);
		});
		const result = await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [cli, ...args], {
				env: {
					...process.env,
					CHELYS_DATA_DIR: dir,
					REMOTE_KEY: 'sensitive-test-key',
				},
			});
			let stdout = '';
			let stderr = '';
			child.stdout.on('data', (chunk) => {
				stdout += chunk;
			});
			child.stderr.on('data', (chunk) => {
				stderr += chunk;
			});
			child.once('error', reject);
			child.once('close', (code) => resolve({ code, stdout, stderr }));
		});
		return { ...result, requests };
	} finally {
		await new Promise((resolve) => server.close(resolve));
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

test('same CLI grammar targets local Chelys settings and remote TeXlyre stores', async () => {
	const local = await runAgainstMock([
		'settings',
		'set',
		'collabAutoReconnect',
		'false',
	]);
	assert.equal(local.code, 0, local.stderr);
	assert.equal(local.requests.at(-1).method, 'chelys.settings.set');
	assert.deepEqual(local.requests.at(-1).params, {
		key: 'collabAutoReconnect',
		value: false,
	});

	const remote = await runAgainstMock([
		'--peer',
		'other-chelys',
		'--api-key-env',
		'REMOTE_KEY',
		'account',
		'properties',
		'set',
		'color:global',
		'"blue"',
	]);
	assert.equal(remote.code, 0, remote.stderr);
	assert.equal(remote.requests.at(-1).method, 'peers.call');
	assert.deepEqual(remote.requests.at(-1).params, {
		target: 'other-chelys',
		method: 'account.store.set',
		params: { store: 'properties', key: 'color:global', value: 'blue' },
		apiKey: 'sensitive-test-key',
	});
});

test('record append uses existing TeXlyre store and remote secret reads remain hidden', async () => {
	const record = await runAgainstMock([
		'account',
		'records',
		'append',
		'project:global',
		'{"status":"ok"}',
	]);
	assert.equal(record.code, 0, record.stderr);
	assert.equal(record.requests.at(-1).method, 'account.store.append');
	assert.deepEqual(record.requests.at(-1).params, {
		store: 'records',
		key: 'project:global',
		value: { status: 'ok' },
	});

	const secret = await runAgainstMock(
		[
			'--peer',
			'other-chelys',
			'--api-key-env',
			'REMOTE_KEY',
			'account',
			'secrets',
			'get',
			'github:global:token',
		],
		() => 'plaintext-test-secret',
	);
	assert.equal(secret.code, 0, secret.stderr);
	assert.equal(secret.requests.at(-1).params.method, 'account.secret.get');
	assert.doesNotMatch(secret.stdout, /plaintext-test-secret/);
	assert.match(secret.stdout, /hidden/);
});

test('monitor CLI uses the existing command API for local and remote requests', async () => {
	const local = await runAgainstMock([
		'recipes',
		'metrics',
		'system-monitor',
		'--fields',
		'cpu,memory',
	]);
	assert.equal(local.code, 0, local.stderr);
	assert.equal(local.requests.at(-1).method, 'recipes.metrics');
	assert.deepEqual(local.requests.at(-1).params, {
		id: 'system-monitor',
		fields: ['cpu', 'memory'],
	});

	const share = await runAgainstMock([
		'recipes',
		'share',
		'system-monitor',
		'set',
		'keys',
		'--fields',
		'cpu,memory',
	]);
	assert.equal(share.code, 0, share.stderr);
	assert.equal(share.requests.at(-1).method, 'recipes.share.set');
	assert.deepEqual(share.requests.at(-1).params, {
		id: 'system-monitor',
		mode: 'keys',
		fields: ['cpu', 'memory'],
	});

	const remote = await runAgainstMock([
		'--peer',
		'lab-server',
		'--api-key-env',
		'REMOTE_KEY',
		'recipes',
		'metrics',
		'system-monitor',
		'--fields',
		'gpu',
	]);
	assert.equal(remote.code, 0, remote.stderr);
	assert.equal(remote.requests.at(-1).params.method, 'recipes.metrics');
	assert.deepEqual(remote.requests.at(-1).params.params, {
		id: 'system-monitor',
		fields: ['gpu'],
	});

	const observer = await runAgainstMock([
		'access',
		'keys',
		'create',
		'observer',
		'recipes.telemetry.read',
		'--fields',
		'cpu,storage',
	]);
	assert.equal(observer.code, 0, observer.stderr);
	assert.deepEqual(observer.requests.at(-1).params.fields, ['cpu', 'storage']);
});

test('profile update supports both generated and manually supplied PRFs', async () => {
	const generated = await runAgainstMock([
		'profile',
		'update',
		'--generate-prf',
	]);
	assert.equal(generated.code, 0, generated.stderr);
	assert.equal(generated.requests.at(-1).method, 'profile.update');
	assert.match(
		generated.requests.at(-1).params.prf_output_hex,
		/^[a-f0-9]{64}$/,
	);
	const manual = await runAgainstMock(['profile', 'update', '--prf', 'aa11']);
	assert.equal(manual.code, 0, manual.stderr);
	assert.deepEqual(manual.requests.at(-1).params, { prf_output_hex: 'aa11' });
	const conflict = await runAgainstMock([
		'profile',
		'update',
		'--generate-prf',
		'--prf',
		'ee',
	]);
	assert.notEqual(conflict.code, 0);
	assert.match(conflict.stderr, /cannot be combined/);
	const remote = await runAgainstMock([
		'--peer',
		'remote',
		'profile',
		'update',
		'--generate-prf',
	]);
	assert.notEqual(remote.code, 0);
	assert.match(remote.stderr, /local-only/);
	const revealRemote = await runAgainstMock([
		'--peer',
		'remote',
		'profile',
		'show',
		'--show-prf',
	]);
	assert.notEqual(revealRemote.code, 0);
	assert.match(revealRemote.stderr, /local-only/);
});

test('registry add uses the existing daemon command without a manifest file', async () => {
	const result = await runAgainstMock([
		'recipes',
		'add',
		'garage-storage',
		'--version',
		'2.4.1',
	]);
	assert.equal(result.code, 0, result.stderr);
	assert.equal(result.requests.at(-1).method, 'recipes.registry.add');
	assert.deepEqual(result.requests.at(-1).params, {
		id: 'garage-storage',
		version: '2.4.1',
	});
});

test('recipe install selects Podman image pull or Dockerfile build and registers missing recipes', async () => {
	const pull = await runAgainstMock([
		'recipes',
		'install',
		'garage-storage',
		'docker',
		'--source',
		'registry',
		'--engine',
		'podman',
		'--initialize-volumes',
	]);
	assert.equal(pull.code, 0, pull.stderr);
	assert.equal(pull.requests.at(-1).method, 'recipes.install');
	assert.deepEqual(pull.requests.at(-1).params, {
		id: 'garage-storage',
		mode: 'docker',
		source: 'registry',
		register: true,
		engine: 'podman',
		initializeVolumes: true,
	});
	const build = await runAgainstMock([
		'recipes',
		'install',
		'garage-storage',
		'docker',
		'--source',
		'build',
		'--version',
		'2.4.1',
	]);
	assert.equal(build.code, 0, build.stderr);
	assert.deepEqual(build.requests.at(-1).params, {
		id: 'garage-storage',
		mode: 'docker',
		source: 'build',
		register: true,
		version: '2.4.1',
		initializeVolumes: false,
	});
});

test('CLI copies a dedicated invitation and saves it using the existing peers namespace', async () => {
	const invitation = 'chelys-webrtc:example';
	const copied = await runAgainstMock(['--local', 'access', 'keys', 'invitation', 'key-id'], () => ({ invitation }));
	assert.equal(copied.code, 0, copied.stderr);
	assert.deepEqual(copied.requests.at(-1).params, { id: 'key-id' });
	assert.equal(copied.requests.at(-1).method, 'access.keys.invitation');
	assert.match(copied.stdout, /chelys-webrtc:example/);
	const saved = await runAgainstMock(['peers', 'connect', 'other-chelys', invitation]);
	assert.equal(saved.code, 0, saved.stderr);
	assert.deepEqual(saved.requests.at(-1).params, { alias: 'other-chelys', url: invitation });
	assert.equal(saved.requests.at(-1).method, 'peers.connect');
});
