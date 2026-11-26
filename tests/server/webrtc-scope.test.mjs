// tests/server/webrtc-scope.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createHeadlessWebRtcScope } from '../../server/webrtc-scope.mjs';

class FakeRTCPeerConnection extends EventTarget {
	constructor(config = {}, constraints) {
		super();
		this.config = config;
		this.constraints = constraints;
		this.connectionState = 'new';
		this.iceConnectionState = 'new';
		this.closeCount = 0;
	}

	changeConnection(state) {
		this.connectionState = state;
		this.dispatchEvent(new Event('connectionstatechange'));
	}

	changeIce(state) {
		this.iceConnectionState = state;
		this.dispatchEvent(new Event('iceconnectionstatechange'));
	}

	close() {
		this.closeCount++;
		this.changeConnection('closed');
		this.changeIce('closed');
		if (this.throwOnClose) throw new Error('native close failed');
	}
}

test('scoped peers preserve native WebRTC configuration and connection API', () => {
	const { RTCPeerConnection, control } = createHeadlessWebRtcScope(
		FakeRTCPeerConnection,
	);
	const configuration = {
		__chelysRuntimeScope: 'account',
		iceServers: [{ urls: 'stun:localhost' }],
	};
	const constraints = { optional: [] };
	const peer = new RTCPeerConnection(configuration, constraints);
	assert.ok(peer instanceof FakeRTCPeerConnection);
	assert.deepEqual(peer.config, { iceServers: [{ urls: 'stun:localhost' }] });
	assert.equal(peer.constraints, constraints);
	assert.deepEqual(configuration, {
		__chelysRuntimeScope: 'account',
		iceServers: [{ urls: 'stun:localhost' }],
	});
	assert.equal(control.getConnectedCount('account'), 0);
	peer.close();
	assert.equal(peer.closeCount, 1);
});

test('native ICE and connection changes produce correct per-scope counts', () => {
	const { RTCPeerConnection, control } = createHeadlessWebRtcScope(
		FakeRTCPeerConnection,
	);
	const messages = [];
	const unsubscribe = control.subscribe('account', (count) =>
		messages.push(count),
	);
	const first = new RTCPeerConnection({ __chelysRuntimeScope: 'account' });
	const second = new RTCPeerConnection({ __chelysRuntimeScope: 'account' });
	const third = new RTCPeerConnection({ __chelysRuntimeScope: 'other' });
	const unscoped = new RTCPeerConnection();
	first.changeIce('connected');
	first.changeConnection('connected');
	first.changeIce('completed');
	second.changeConnection('connected');
	third.changeConnection('connected');
	unscoped.changeConnection('connected');
	assert.deepEqual(messages, [0, 1, 2]);
	assert.equal(control.getConnectedCount('account'), 2);
	assert.equal(control.getConnectedCount('other'), 1);
	first.changeConnection('disconnected');
	second.changeIce('failed');
	assert.deepEqual(messages, [0, 1, 2, 1, 0]);
	first.changeIce('connected');
	first.close();
	assert.deepEqual(messages, [0, 1, 2, 1, 0, 1, 0]);
	unsubscribe();
	second.changeConnection('connected');
	assert.deepEqual(messages, [0, 1, 2, 1, 0, 1, 0]);
	assert.equal(control.getConnectedCount('account'), 1);
	second.close();
	third.close();
	unscoped.close();
});

test('scope reset closes only connections from the requested account or session', async () => {
	const { RTCPeerConnection, control } = createHeadlessWebRtcScope(
		FakeRTCPeerConnection,
	);
	const account = new RTCPeerConnection({ __chelysRuntimeScope: 'account' });
	const another = new RTCPeerConnection({ __chelysRuntimeScope: 'other' });
	const unscoped = new RTCPeerConnection();
	account.changeIce('connected');
	another.changeIce('connected');
	unscoped.changeIce('connected');
	const messages = [];
	const unsubscribe = control.subscribe('account', (count) =>
		messages.push(count),
	);
	await control.reset('account');
	assert.equal(account.closeCount, 1);
	assert.equal(another.closeCount, 0);
	assert.equal(unscoped.closeCount, 0);
	assert.equal(control.getConnectedCount('account'), 0);
	assert.equal(control.getConnectedCount('other'), 1);
	assert.deepEqual(messages, [1, 0]);
	await control.reset('account');
	assert.equal(account.closeCount, 1);
	const replacement = new RTCPeerConnection({
		__chelysRuntimeScope: 'account',
	});
	replacement.changeConnection('connected');
	assert.equal(control.getConnectedCount('account'), 1);
	assert.deepEqual(messages, [1, 0, 1]);
	unsubscribe();
	await control.reset('account');
	await control.reset('other');
	unscoped.close();
});

test('failed native close does not leave stale scope state', async () => {
	const { RTCPeerConnection, control } = createHeadlessWebRtcScope(
		FakeRTCPeerConnection,
	);
	const peer = new RTCPeerConnection({ __chelysRuntimeScope: 'account' });
	peer.changeConnection('connected');
	peer.throwOnClose = true;
	const oldWarn = console.warn;
	const warnings = [];
	console.warn = (...args) => warnings.push(args);
	try {
		await control.reset('account');
	} finally {
		console.warn = oldWarn;
	}
	assert.equal(control.getConnectedCount('account'), 0);
	assert.equal(peer.closeCount, 1);
	assert.equal(warnings.length, 1);
});

test('installed headless WebRTC binding supports the scoped constructor', async (t) => {
	const requireServer = createRequire(
		new URL('../../server/package.json', import.meta.url),
	);
	let native;
	try {
		native = requireServer('@roamhq/wrtc');
	} catch (error) {
		if (error.code !== 'MODULE_NOT_FOUND') throw error;
		t.skip('Install server dependencies to run the native addon test');
		return;
	}
	const { RTCPeerConnection, control } = createHeadlessWebRtcScope(
		native.RTCPeerConnection,
	);
	const peer = new RTCPeerConnection({
		__chelysRuntimeScope: 'native',
		iceServers: [],
	});
	assert.ok(peer instanceof native.RTCPeerConnection);
	assert.equal(control.getConnectedCount('native'), 0);
	await control.reset('native');
	assert.equal(control.getConnectedCount('native'), 0);
});
