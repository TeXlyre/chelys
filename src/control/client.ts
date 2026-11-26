// src/control/client.ts
import { chelysAccountSyncService } from '@texlyre/services/ChelysAccountSyncService';
import {
	readPeerState,
	readHostAdvertisements,
} from '@chelys/peer/SessionContract';
import { openSession } from '@chelys/peer/SessionClient';
import {
	findPeerConnection,
	acquireChannel,
} from '@chelys/peer/TransportChannel';
import { FrameReassembler, encodeFrames } from '@chelys/peer/TransportFraming';
import { readSignalingServers } from '@chelys/peer/TransportResolution';
import {
	CONTROL_LABEL_PREFIX,
	type RpcRequest,
	type RpcResponse,
} from './protocol';

const PEER_ENDPOINTS = 'chelys-peer-endpoints';
const TIMEOUT = 30_000;
const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));
const toText = (data: string | Uint8Array) =>
	typeof data === 'string' ? data : new TextDecoder().decode(data);

export function peerEndpoints(): Record<string, string> {
	try {
		const result = JSON.parse(localStorage.getItem(PEER_ENDPOINTS) || '{}');
		return result && typeof result === 'object' && !Array.isArray(result)
			? result
			: {};
	} catch {
		return {};
	}
}
export function addPeerEndpoint(name: string, url: string): void {
	if (
		!/^[a-zA-Z0-9_-]{1,64}$/.test(name) ||
		['__proto__', 'prototype', 'constructor'].includes(name)
	)
		throw new Error('Peer alias must be letters, numbers, _ or -');
	const parsed = new URL(url);
	if (
		!['ws:', 'wss:'].includes(parsed.protocol) ||
		parsed.username ||
		parsed.password
	)
		throw new Error('WebSocket URL required');
	if (
		parsed.protocol === 'ws:' &&
		!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
	) {
		throw new Error('Remote WebSocket requires wss:// (TLS)');
	}
	localStorage.setItem(
		PEER_ENDPOINTS,
		JSON.stringify({ ...peerEndpoints(), [name]: parsed.toString() }),
	);
}
export function removePeerEndpoint(name: string): void {
	const entries = peerEndpoints();
	if (!entries[name]) throw new Error('Unknown peer alias');
	delete entries[name];
	localStorage.setItem(PEER_ENDPOINTS, JSON.stringify(entries));
}
export function listAvailablePeers(): Array<Record<string, unknown>> {
	const configured = Object.entries(peerEndpoints()).map(([alias, url]) => ({
		alias,
		url,
		transport: 'websocket',
		controlAvailable: true,
	}));
	const connection = chelysAccountSyncService.getConnection();
	if (!connection) return configured;
	const discovered: Array<Record<string, unknown>> = [];
	for (const [clientId, state] of connection.awareness.getStates()) {
		if (clientId === connection.awareness.clientID) continue;
		const peer = readPeerState(state);
		if (!peer) continue;
		const advertisements = readHostAdvertisements(state);
		let controlAdvertised = false;
		for (const advert of Object.values(advertisements)) {
			if (
				!advert ||
				typeof advert.label !== 'string' ||
				typeof advert.hostInstanceId !== 'string' ||
				!advert.label.startsWith(CONTROL_LABEL_PREFIX)
			)
				continue;
			controlAdvertised = true;
			discovered.push({
				id: advert.label.slice(CONTROL_LABEL_PREFIX.length),
				instanceId: advert.hostInstanceId,
				peerKind: peer.kind,
				username: peer.username,
				transport: 'webrtc',
				controlAvailable: true,
			});
		}
		if (!controlAdvertised && peer.kind === 'chelys') {
			discovered.push({
				id: peer.instanceId,
				instanceId: peer.instanceId,
				peerKind: peer.kind,
				username: peer.username,
				transport: 'webrtc',
				controlAvailable: false,
			});
		}
	}
	return [
		...new Map(discovered.map((peer) => [peer.id, peer])).values(),
		...configured,
	];
}

export interface LocalCollaborator {
	clientId: number;
	isLocal: boolean;
	user: {
		username: string;
		name?: string;
		email?: string;
		color: string;
		colorLight?: string;
	};
}

/** Account presence is observed by the daemon, never by a second desktop WebRTC connection. */
export function listAccountCollaborators(): LocalCollaborator[] {
	const connection = chelysAccountSyncService.getConnection();
	if (!connection) return [];
	const users: LocalCollaborator[] = [];
	for (const [clientId, state] of connection.awareness.getStates()) {
		if (!state.user || typeof state.user !== 'object') continue;
		const user = state.user as Record<string, unknown>;
		if (typeof user.username !== 'string') continue;
		users.push({
			clientId,
			isLocal: clientId === connection.awareness.clientID,
			user: {
				username: user.username,
				...(typeof user.name === 'string' ? { name: user.name } : {}),
				...(typeof user.email === 'string' ? { email: user.email } : {}),
				color: typeof user.color === 'string' ? user.color : '#64748b',
				...(typeof user.colorLight === 'string'
					? { colorLight: user.colorLight }
					: {}),
			},
		});
	}
	return users.sort(
		(a, b) =>
			Number(b.isLocal) - Number(a.isLocal) ||
			a.user.username.localeCompare(b.user.username),
	);
}
export function connectedTexlyrePeers(): Array<{
	username: string;
	instanceId: string;
}> {
	const connection = chelysAccountSyncService.getConnection();
	if (!connection) return [];
	const peers = new Map<string, { username: string; instanceId: string }>();
	for (const [clientId, state] of connection.awareness.getStates()) {
		if (clientId === connection.awareness.clientID) continue;
		const peer = readPeerState(state);
		if (peer?.kind !== 'texlyre' || !peer.transportPeerId) continue;
		if (!findPeerConnection(connection.provider, peer.transportPeerId))
			continue;
		peers.set(peer.instanceId, {
			username: peer.username,
			instanceId: peer.instanceId,
		});
	}
	return [...peers.values()];
}

function requestMessage(
	method: string,
	params: Record<string, unknown>,
	apiKey?: string,
): RpcRequest {
	return { v: 1, id: crypto.randomUUID(), method, params, apiKey };
}
function checkResponse(response: RpcResponse, request: RpcRequest): unknown {
	if (response.v !== 1 || response.id !== request.id)
		throw new Error('Invalid RPC response');
	if (!response.ok) throw new Error(response.error || 'Remote command failed');
	return response.result;
}
async function viaWebSocket(
	url: string,
	request: RpcRequest,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		const timeout = setTimeout(
			() => finish(new Error('WebSocket request timed out')),
			TIMEOUT,
		);
		let done = false;
		function finish(error?: Error, response?: unknown) {
			if (done) return;
			done = true;
			clearTimeout(timeout);
			socket.close();
			if (error) reject(error);
			else resolve(response);
		}
		socket.addEventListener('open', () => socket.send(JSON.stringify(request)));
		socket.addEventListener('error', () =>
			finish(new Error('WebSocket connection failed')),
		);
		socket.addEventListener('message', (event) => {
			try {
				finish(
					undefined,
					checkResponse(JSON.parse(String(event.data)), request),
				);
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		});
	});
}
async function viaWebRtc(
	target: string,
	request: RpcRequest,
): Promise<unknown> {
	const account = chelysAccountSyncService.getConnection();
	if (!account) throw new Error('Login required to connect over WebRTC');
	const lease = await openSession({
		baseRoomId: account.roomId,
		controlRoomId: account.roomId,
		controlMode: 'account',
		signaling: readSignalingServers(account.userId),
		label: CONTROL_LABEL_PREFIX + target,
	});
	try {
		const end = Date.now() + TIMEOUT;
		let peer = null;
		while (Date.now() < end) {
			peer =
				findPeerConnection(
					lease.connection.provider,
					lease.remoteTransportPeerId,
				)?.peer ?? null;
			if (peer) break;
			await sleep(75);
		}
		if (!peer) throw new Error('WebRTC service peer not connected');
		const acquired = acquireChannel(peer, lease.channelLabel);
		if (!acquired) throw new Error('Unable to create control data channel');
		const channel = acquired.channel;
		return await new Promise<unknown>((resolve, reject) => {
			let done = false;
			const reassembler = new FrameReassembler();
			const timer = setTimeout(
				() => finish(new Error('WebRTC response timed out')),
				TIMEOUT,
			);
			const unsubscribe = lease.onInvalid((error) => finish(error));
			function finish(error?: Error, result?: unknown) {
				if (done) return;
				done = true;
				clearTimeout(timer);
				unsubscribe();
				channel.close();
				if (error) reject(error);
				else resolve(result);
			}
			const send = () => {
				try {
					for (const frame of encodeFrames(JSON.stringify(request)))
						channel.send(frame);
				} catch (error) {
					finish(error instanceof Error ? error : new Error(String(error)));
				}
			};
			channel.onopen = () => send();
			channel.onclose = () => finish(new Error('WebRTC channel closed'));
			channel.onerror = () => finish(new Error('WebRTC channel failed'));
			channel.onmessage = (event) => {
				try {
					const frame = reassembler.push(event.data as ArrayBuffer);
					if (frame !== null)
						finish(
							undefined,
							checkResponse(JSON.parse(toText(frame)), request),
						);
				} catch (error) {
					finish(error instanceof Error ? error : new Error(String(error)));
				}
			};
			if (channel.readyState === 'open') send();
		});
	} finally {
		lease.release();
	}
}
export async function callRemotePeer(
	target: string,
	method: string,
	params: Record<string, unknown> = {},
	apiKey?: string,
): Promise<unknown> {
	const endpoint = peerEndpoints()[target];
	const request = requestMessage(method, params, apiKey);
	return endpoint
		? viaWebSocket(endpoint, request)
		: viaWebRtc(target, request);
}
