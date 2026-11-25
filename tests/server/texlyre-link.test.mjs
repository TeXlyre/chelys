// tests/server/texlyre-link.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../server/cli.mjs', import.meta.url));
const prf = 'ab'.repeat(32);

async function run(
	args,
	{
		loggedIn = true,
		baseUrl = 'https://texlyre.example/texlyre/',
		connectedAfter = 1,
		credentials = true,
	} = {},
) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chelys-texlyre-link-'));
	const helper = path.join(dir, 'mock-credentials.cjs');
	fs.writeFileSync(
		helper,
		`#!/usr/bin/env node
process.stdout.write(JSON.stringify({credentials:${credentials ? JSON.stringify({ username: 'alice', password: 'secret', prf_output_hex: prf }) : 'null'},storage:{backend:'keyring',warning:null,migrated:false}}));
`,
		{ mode: 0o700 },
	);
	const requests = [];
	let inspections = 0;
	const server = net.createServer((socket) => {
		let buffer = '';
		socket.setEncoding('utf8');
		socket.on('data', (data) => {
			buffer += data;
			const end = buffer.indexOf('\n');
			if (end < 0) return;
			const request = JSON.parse(buffer.slice(0, end));
			requests.push(request);
			let result;
			if (request.method === 'account.status')
				result = { loggedIn, username: 'alice', accountId: 'account-1' };
			else if (request.method === 'chelys.settings.get') result = baseUrl;
			else if (request.method === 'account.texlyre.peers')
				result =
					++inspections >= connectedAfter
						? [{ username: 'alice', instanceId: 'texlyre-1' }]
						: [];
			else if (request.method === 'peers.default.get')
				result = { target: null };
			else result = null;
			socket.end(
				`${JSON.stringify({ v: 1, id: request.id, ok: true, result })}\n`,
			);
		});
	});
	try {
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(path.join(dir, 'chelys.sock'), resolve);
		});
		return await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [cli, ...args], {
				env: {
					...process.env,
					CHELYS_DATA_DIR: dir,
					CHELYS_CREDENTIAL_HELPER: helper,
					CHELYS_PEER: '',
				},
			});
			let stdout = '';
			let stderr = '';
			const timer = setTimeout(() => child.kill('SIGKILL'), 7_000);
			child.stdout.on('data', (chunk) => {
				stdout += chunk;
			});
			child.stderr.on('data', (chunk) => {
				stderr += chunk;
			});
			child.once('error', reject);
			child.once('close', (code) => {
				clearTimeout(timer);
				resolve({ code, stdout, stderr, requests, inspections });
			});
		});
	} finally {
		await new Promise((resolve) => server.close(resolve));
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

test('open TeXlyre prints the configured session link and waits for a connected peer', async () => {
	const result = await run(['--open-texlyre'], { connectedAfter: 2 });
	assert.equal(result.code, 0, result.stderr);
	assert.match(
		result.stdout,
		new RegExp(`https://texlyre\\.example/texlyre/#tempPrf:${prf}`),
	);
	assert.match(result.stdout, /Waiting for a connected TeXlyre WebRTC peer/);
	assert.match(result.stdout, /TeXlyre WebRTC connected: alice/);
	assert.equal(result.inspections, 2);
	assert.ok(
		result.requests.some(
			(request) =>
				request.method === 'chelys.settings.get' &&
				request.params.key === 'texlyreBaseUrl',
		),
	);
	assert.ok(
		result.requests.every((request) => request.method !== 'peers.call'),
	);
});

test('open TeXlyre requires a matching local active account', async () => {
	const inactive = await run(['--open-texlyre'], { loggedIn: false });
	assert.notEqual(inactive.code, 0);
	assert.match(inactive.stderr, /Login required/);
	assert.doesNotMatch(inactive.stdout, /tempPrf/);
	const missing = await run(['--open-texlyre'], { credentials: false });
	assert.notEqual(missing.code, 0);
	assert.match(missing.stderr, /Saved login does not match/);
});

test('open TeXlyre rejects remote requests and invalid configured URLs', async () => {
	const remote = await run(['--peer', 'remote', '--open-texlyre']);
	assert.notEqual(remote.code, 0);
	assert.match(remote.stderr, /local-only/);
	const malformed = await run(['--open-texlyre'], {
		baseUrl: 'javascript:alert(1)',
	});
	assert.notEqual(malformed.code, 0);
	assert.match(malformed.stderr, /texlyreBaseUrl/);
	assert.doesNotMatch(malformed.stdout, /tempPrf/);
});
