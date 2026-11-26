// tests/server/signaling-origin.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSignalingWebSocket } from '../../server/signaling-websocket.mjs';

class FakeWebSocket {
	constructor(url, protocols, options) {
		this.url = url;
		this.protocols = protocols;
		this.options = options;
	}
}

function storage(entries) {
	return {
		length: Object.keys(entries).length,
		key(index) {
			return Object.keys(entries)[index] ?? null;
		},
		getItem(key) {
			return entries[key] ?? null;
		},
	};
}

const origin = () => 'http://localhost:5173';

test('configured y-webrtc servers receive the configured Origin', () => {
	const WebSocket = createSignalingWebSocket(
		FakeWebSocket,
		storage({
			'texlyre-user-account-settings': JSON.stringify({
				'collab-signaling-servers': 'wss://signal.example',
			}),
		}),
		origin,
	);
	assert.equal(
		new WebSocket('wss://signal.example').options.origin,
		'http://localhost:5173',
	);
	assert.equal(
		new WebSocket('ws://ywebrtc.localhost:8082').options.origin,
		'http://localhost:5173',
	);
});

test('y-websocket room paths match configured server prefixes, not similar routes', () => {
	const WebSocket = createSignalingWebSocket(
		FakeWebSocket,
		storage({
			'texlyre-user-account-settings': JSON.stringify({
				'collab-websocket-server': 'wss://example.org/yjs',
			}),
		}),
		origin,
	);
	assert.equal(
		new WebSocket('wss://example.org/yjs/project-room?token=abc').options
			.origin,
		'http://localhost:5173',
	);
	assert.equal(
		new WebSocket('wss://example.org/yjs').options.origin,
		'http://localhost:5173',
	);
	assert.equal(
		new WebSocket('wss://example.org/yjs-other/room').options,
		undefined,
	);
	assert.equal(new WebSocket('wss://another.org/yjs/room').options, undefined);
});

test('configured FilePizza HTTP endpoints can match WebSocket signaling handshakes', () => {
	const WebSocket = createSignalingWebSocket(
		FakeWebSocket,
		storage({
			'texlyre-user-account-settings': JSON.stringify({
				'file-sync-server-url': 'https://pizza.example.net',
			}),
		}),
		origin,
	);
	assert.equal(
		new WebSocket('wss://pizza.example.net/socket.io/?transport=websocket')
			.options.origin,
		'http://localhost:5173',
	);
	assert.equal(
		new WebSocket('ws://pizza.example.net/socket.io/').options,
		undefined,
	);
});

test('dynamic setting changes affect new connections without changing existing ones', () => {
	let configured = 'http://localhost:5173';
	const WebSocket = createSignalingWebSocket(
		FakeWebSocket,
		storage({
			'chelys-user-a-settings': JSON.stringify({
				collabSignalingServers: 'wss://signal.internal',
			}),
		}),
		() => configured,
	);
	const first = new WebSocket('wss://signal.internal');
	configured = 'chelys://headless';
	const second = new WebSocket('wss://signal.internal', ['protocol'], {
		handshakeTimeout: 3000,
	});
	assert.equal(first.options.origin, 'http://localhost:5173');
	assert.deepEqual(second.options, {
		handshakeTimeout: 3000,
		origin: 'chelys://headless',
	});
	assert.deepEqual(second.protocols, ['protocol']);
});

test('environment override takes precedence over config and does not affect recipes', () => {
	const previous = process.env.CHELYS_SIGNALING_ORIGIN;
	process.env.CHELYS_SIGNALING_ORIGIN = 'chelys://override';
	try {
		const WebSocket = createSignalingWebSocket(
			FakeWebSocket,
			storage({
				'texlyre-user-account-settings': JSON.stringify({
					'collab-signaling-servers': 'wss://signal.example',
				}),
			}),
			origin,
		);
		assert.equal(
			new WebSocket('wss://signal.example').options.origin,
			'chelys://override',
		);
		assert.equal(new WebSocket('ws://localhost:7060').options, undefined);
		assert.deepEqual(
			new WebSocket('wss://remote.example/control', [], {
				handshakeTimeout: 5000,
			}).options,
			{ handshakeTimeout: 5000 },
		);
	} finally {
		if (previous === undefined) delete process.env.CHELYS_SIGNALING_ORIGIN;
		else process.env.CHELYS_SIGNALING_ORIGIN = previous;
	}
});

test('ws options in second argument retain their shape', () => {
	const WebSocket = createSignalingWebSocket(
		FakeWebSocket,
		storage({
			'texlyre-settings': JSON.stringify({
				'collab-signaling-servers': 'wss://signal.example',
			}),
		}),
		origin,
	);
	assert.deepEqual(
		new WebSocket('wss://signal.example', { handshakeTimeout: 5000 }).protocols,
		{
			handshakeTimeout: 5000,
			origin: 'http://localhost:5173',
		},
	);
});

test('invalid settings and empty origin leave other WebSocket connections untouched', () => {
	const WebSocket = createSignalingWebSocket(
		FakeWebSocket,
		storage({
			'texlyre-user-account-settings': '{ malformed',
		}),
		() => '',
	);
	assert.equal(new WebSocket('wss://unconfigured.example').options, undefined);
	assert.equal(new WebSocket('ws://ywebrtc.localhost:8082').options, undefined);
});

test('saved WebRTC invitations supply their signaling Origin without modifying direct endpoints', () => {
	const invite = 'chelys-webrtc:' + Buffer.from(JSON.stringify({ room: 'test-room', signaling: ['wss://other.example/signal'] })).toString('base64');
	const WebSocket = createSignalingWebSocket(FakeWebSocket, storage({
		'chelys-peer-endpoints': JSON.stringify({ remote: invite, direct: 'wss://direct.example/control' }),
	}), origin);
	assert.equal(new WebSocket('wss://other.example/signal').options.origin, origin());
	assert.equal(new WebSocket('wss://direct.example/control').options, undefined);
});
