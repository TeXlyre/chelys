// scripts/server-dependencies.mjs
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

export function checkServerDependencies(serverDir) {
	try {
		for (const dependency of ['@roamhq/wrtc', 'ws']) {
			if (
				!fs.existsSync(
					path.join(
						serverDir,
						'node_modules',
						...dependency.split('/'),
						'package.json',
					),
				)
			) {
				throw new Error(`${dependency} is missing from server/node_modules`);
			}
		}
		const fromServer = createRequire(path.join(serverDir, 'package.json'));
		const wrtc = fromServer('@roamhq/wrtc');
		const WebSocket = fromServer('ws');
		for (const exportName of [
			'RTCPeerConnection',
			'RTCSessionDescription',
			'RTCIceCandidate',
		]) {
			if (typeof wrtc[exportName] !== 'function') {
				throw new Error(`@roamhq/wrtc does not provide ${exportName}`);
			}
		}
		if (typeof WebSocket !== 'function')
			throw new Error('ws does not provide a WebSocket constructor');
		return null;
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
}

export function ensureServerDependencies(
	serverDir,
	{ run = spawnSync, platform = process.platform, log = console.log } = {},
) {
	if (!checkServerDependencies(serverDir)) return false;
	log(
		'Installing native headless WebRTC dependencies for the Chelys distribution...',
	);
	const result = run(
		platform === 'win32' ? 'npm.cmd' : 'npm',
		['install', '--prefix', serverDir, '--omit=dev', '--no-audit', '--no-fund'],
		{ stdio: 'inherit', shell: platform === 'win32' },
	);
	if (result.error || result.status !== 0) {
		throw new Error(
			`Headless dependency installation failed: ${result.error?.message ?? `npm exited with ${result.status}`}`,
		);
	}
	const error = checkServerDependencies(serverDir);
	if (error) {
		throw new Error(
			`Native headless WebRTC dependencies are installed but cannot be loaded: ${error.message}. Check that @roamhq/wrtc supports this Node.js version and platform.`,
		);
	}
	return true;
}
