// tests/server/server-dependencies.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	checkServerDependencies,
	ensureServerDependencies,
} from '../../scripts/server-dependencies.mjs';

function createFixture() {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), 'chelys-server-dependencies-'),
	);
	const server = path.join(root, 'server');
	fs.mkdirSync(server);
	fs.writeFileSync(
		path.join(server, 'package.json'),
		JSON.stringify({ name: 'test-server', private: true }),
	);
	return { root, server };
}

function populateDependencies(server, valid = true) {
	const wrtc = path.join(server, 'node_modules', '@roamhq', 'wrtc');
	const ws = path.join(server, 'node_modules', 'ws');
	fs.mkdirSync(wrtc, { recursive: true });
	fs.mkdirSync(ws, { recursive: true });
	fs.writeFileSync(
		path.join(wrtc, 'package.json'),
		JSON.stringify({ name: '@roamhq/wrtc', main: 'index.js' }),
	);
	fs.writeFileSync(
		path.join(ws, 'package.json'),
		JSON.stringify({ name: 'ws', main: 'index.js' }),
	);
	fs.writeFileSync(
		path.join(wrtc, 'index.js'),
		valid
			? 'exports.RTCPeerConnection = function () {}; exports.RTCSessionDescription = function () {}; exports.RTCIceCandidate = function () {};'
			: 'exports.RTCPeerConnection = {}',
	);
	fs.writeFileSync(
		path.join(ws, 'index.js'),
		'module.exports = function WebSocket() {};',
	);
}

test('distribution packaging installs missing native server dependencies before copying them', () => {
	const { root, server } = createFixture();
	try {
		let calls = 0;
		const result = ensureServerDependencies(server, {
			platform: 'linux',
			log() {},
			run(executable, args, options) {
				calls++;
				assert.equal(executable, 'npm');
				assert.deepEqual(args, [
					'install',
					'--prefix',
					server,
					'--omit=dev',
					'--no-audit',
					'--no-fund',
				]);
				assert.equal(options.shell, false);
				populateDependencies(server);
				return { status: 0 };
			},
		});
		assert.equal(result, true);
		assert.equal(calls, 1);
		assert.equal(checkServerDependencies(server), null);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('existing working WebRTC dependencies are reused without another install', () => {
	const { root, server } = createFixture();
	try {
		populateDependencies(server);
		assert.equal(
			ensureServerDependencies(server, {
				run() {
					throw new Error('Unexpected npm call');
				},
			}),
			false,
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('invalid native WebRTC exports fail packaging even when npm claims success', () => {
	const { root, server } = createFixture();
	try {
		populateDependencies(server, false);
		assert.throws(
			() =>
				ensureServerDependencies(server, {
					log() {},
					run() {
						return { status: 0 };
					},
				}),
			/cannot be loaded/,
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('installation failures are reported rather than silently shipping an unusable addon', () => {
	const { root, server } = createFixture();
	try {
		assert.throws(
			() =>
				ensureServerDependencies(server, {
					platform: 'win32',
					log() {},
					run(command, _args, options) {
						assert.equal(command, 'npm.cmd');
						assert.equal(options.shell, true);
						return { status: 1 };
					},
				}),
			/installation failed/,
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
