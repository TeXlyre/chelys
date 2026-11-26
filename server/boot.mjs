// server/boot.mjs
import { WebSocket } from 'ws';
import wrtc from '@roamhq/wrtc';
import { createLocalStorage, ensureDataDir } from './data.mjs';
import { createHeadlessWebRtcScope } from './webrtc-scope.mjs';
import { createSignalingWebSocket } from './signaling-websocket.mjs';

let signalingOrigin = null;

export function setSignalingOrigin(origin) {
	signalingOrigin = origin;
}

export function bootstrapHeadless() {
	ensureDataDir();
	const target = new EventTarget();
	const localStorage = createLocalStorage();
	const SignalingWebSocket = createSignalingWebSocket(
		WebSocket,
		localStorage,
		() =>
			typeof signalingOrigin === 'function'
				? signalingOrigin()
				: signalingOrigin,
	);
	const { RTCPeerConnection, control } = createHeadlessWebRtcScope(
		wrtc.RTCPeerConnection,
	);

	target.__TAURI_INTERNALS__ = {};
	target.localStorage = localStorage;
	target.WebSocket = SignalingWebSocket;
	target.RTCPeerConnection = RTCPeerConnection;
	target.RTCSessionDescription = wrtc.RTCSessionDescription;
	target.RTCIceCandidate = wrtc.RTCIceCandidate;
	target.RTCDataChannel = wrtc.RTCDataChannel;
	target.crypto = globalThis.crypto;
	globalThis.window = target;
	globalThis.localStorage = localStorage;
	globalThis.WebSocket = SignalingWebSocket;
	globalThis.RTCPeerConnection = RTCPeerConnection;
	globalThis.__CHELYS_WEBRTC_SCOPE_CONTROL__ = control;
	globalThis.RTCSessionDescription = wrtc.RTCSessionDescription;
	globalThis.RTCIceCandidate = wrtc.RTCIceCandidate;
	globalThis.RTCDataChannel = wrtc.RTCDataChannel;
}
