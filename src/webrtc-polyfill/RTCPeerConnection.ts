// src/webrtc-polyfill/RTCPeerConnection.ts
import { invoke } from '@tauri-apps/api/core';

import { TauriRTCDataChannel } from './RTCDataChannel';

interface QueuedEvent {
	type: string;
	payload: unknown;
}

interface DataChannelPayload {
	channelId: string;
	label: string;
	ordered: boolean;
	protocol: string;
}

interface ScopedRtcConfiguration extends RTCConfiguration {
	__chelysRuntimeScope?: string;
}

type ScopeListener = (connectedPeers: number) => void;

const peerByHandle = new Map<string, TauriRTCPeerConnection>();
const knownPeerHandles = new Set<string>();
const pendingPeerEvents = new Map<string, QueuedEvent[]>();
const channelByHandle = new Map<string, TauriRTCDataChannel>();
const pendingChannelEvents = new Map<string, QueuedEvent[]>();

const peersByScope = new Map<string, Set<TauriRTCPeerConnection>>();
const connectedPeersByScope = new Map<string, Set<TauriRTCPeerConnection>>();
const scopeListeners = new Map<string, Set<ScopeListener>>();
const lastNotifiedScopeCount = new Map<string, number>();

const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));

const stateName = (value: unknown): string => String(value ?? '').toLowerCase();

const notifyScope = (scopeId: string): void => {
	const connected = connectedPeersByScope.get(scopeId)?.size ?? 0;
	if (lastNotifiedScopeCount.get(scopeId) === connected) return;
	lastNotifiedScopeCount.set(scopeId, connected);
	for (const listener of scopeListeners.get(scopeId) ?? []) {
		listener(connected);
	}
};

const registerScopedPeer = (peer: TauriRTCPeerConnection): void => {
	const scopeId = peer.nativeScopeId;
	if (!scopeId) return;
	const peers = peersByScope.get(scopeId) ?? new Set<TauriRTCPeerConnection>();
	peers.add(peer);
	peersByScope.set(scopeId, peers);
	notifyScope(scopeId);
};

const setScopedPeerConnected = (
	peer: TauriRTCPeerConnection,
	connected: boolean,
): void => {
	const scopeId = peer.nativeScopeId;
	if (!scopeId) return;
	const peers =
		connectedPeersByScope.get(scopeId) ?? new Set<TauriRTCPeerConnection>();
	const changed = connected ? !peers.has(peer) : peers.has(peer);
	if (connected) peers.add(peer);
	else peers.delete(peer);
	if (peers.size > 0) connectedPeersByScope.set(scopeId, peers);
	else connectedPeersByScope.delete(scopeId);
	if (changed) notifyScope(scopeId);
};

const unregisterScopedPeer = (peer: TauriRTCPeerConnection): void => {
	const scopeId = peer.nativeScopeId;
	if (!scopeId) return;

	setScopedPeerConnected(peer, false);
	const peers = peersByScope.get(scopeId);
	peers?.delete(peer);
	if (peers?.size === 0) peersByScope.delete(scopeId);
	notifyScope(scopeId);
};

export function getConnectedPeerCount(scopeId: string): number {
	return connectedPeersByScope.get(scopeId)?.size ?? 0;
}

export function subscribePeerScope(
	scopeId: string,
	listener: ScopeListener,
): () => void {
	const listeners = scopeListeners.get(scopeId) ?? new Set<ScopeListener>();
	listeners.add(listener);
	scopeListeners.set(scopeId, listeners);
	const connected = getConnectedPeerCount(scopeId);
	if (!lastNotifiedScopeCount.has(scopeId)) {
		lastNotifiedScopeCount.set(scopeId, connected);
	}
	listener(connected);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) scopeListeners.delete(scopeId);
	};
}

export async function resetPeerScope(scopeId: string): Promise<void> {
	const peers = [...(peersByScope.get(scopeId) ?? [])];
	await Promise.allSettled(peers.map((peer) => peer.close()));

	try {
		await invoke('rtc_reset_peer_scope', { scopeId });
	} catch (error) {
		console.warn(`[rtc] failed to reset native scope ${scopeId}:`, error);
	}

	for (const peer of peers) peer.retireAfterScopeReset();
	peersByScope.delete(scopeId);
	connectedPeersByScope.delete(scopeId);
	notifyScope(scopeId);
}

export function dispatchChannelEvent(
	channelId: string,
	type: string,
	payload: unknown,
): void {
	const channel = channelByHandle.get(channelId);
	if (channel) {
		channel.emit(type, payload);
		if (type === 'close') channelByHandle.delete(channelId);
		return;
	}

	const queued = pendingChannelEvents.get(channelId) ?? [];
	queued.push({ type, payload });
	pendingChannelEvents.set(channelId, queued);
}

export function registerChannel(
	channelId: string,
	channel: TauriRTCDataChannel,
): void {
	channelByHandle.set(channelId, channel);

	const queued = pendingChannelEvents.get(channelId);
	if (!queued) return;

	pendingChannelEvents.delete(channelId);
	for (const event of queued) channel.emit(event.type, event.payload);
	if (channel.readyState === 'closed') channelByHandle.delete(channelId);
}

export function dispatchPeerEvent(
	peerId: string,
	type: string,
	payload: unknown,
): void {
	const peer = peerByHandle.get(peerId);
	if (peer) {
		peer.emit(type, payload);
		if (type === 'connectionstatechange' && stateName(payload) === 'closed') {
			peerByHandle.delete(peerId);
		}
		return;
	}

	// The native side may emit the first event before rtc_create_peer resolves.
	// Events from a known but already retired handle are intentionally ignored.
	if (knownPeerHandles.has(peerId)) return;

	const queued = pendingPeerEvents.get(peerId) ?? [];
	queued.push({ type, payload });
	pendingPeerEvents.set(peerId, queued);
}

class TauriRTCSessionDescription {
	constructor(
		public type: string,
		public sdp: string,
	) {}

	toJSON(): { type: string; sdp: string } {
		return { type: this.type, sdp: this.sdp };
	}
}

class TauriRTCIceCandidate {
	readonly candidate: string;
	readonly sdpMid: string | null;
	readonly sdpMLineIndex: number | null;
	readonly usernameFragment: string | null;

	constructor(init: Partial<RTCIceCandidateInit>) {
		this.candidate = init.candidate ?? '';
		this.sdpMid = init.sdpMid ?? null;
		this.sdpMLineIndex = init.sdpMLineIndex ?? null;
		this.usernameFragment = init.usernameFragment ?? null;
	}

	toJSON(): RTCIceCandidateInit {
		return {
			candidate: this.candidate,
			sdpMid: this.sdpMid,
			sdpMLineIndex: this.sdpMLineIndex,
			usernameFragment: this.usernameFragment,
		};
	}
}

type PeerEventHandler<TEvent extends Event = Event> =
	| ((this: TauriRTCPeerConnection, event: TEvent) => unknown)
	| null;

export class TauriRTCPeerConnection extends EventTarget {
	readonly nativeScopeId: string | null;

	private peerId: string | null = null;
	private readonly peerIdPromise: Promise<string>;
	private pendingChannelOps: Promise<unknown> = Promise.resolve();
	private closePromise: Promise<void> | null = null;
	private readonly channelIds = new Set<string>();
	private retired = false;

	iceConnectionState: RTCIceConnectionState = 'new';
	connectionState: RTCPeerConnectionState = 'new';
	signalingState: RTCSignalingState = 'stable';
	iceGatheringState: RTCIceGatheringState = 'new';
	localDescription: TauriRTCSessionDescription | null = null;
	remoteDescription: TauriRTCSessionDescription | null = null;

	onicecandidate: PeerEventHandler<RTCPeerConnectionIceEvent> = null;
	ondatachannel: PeerEventHandler<RTCDataChannelEvent> = null;
	oniceconnectionstatechange: PeerEventHandler = null;
	onconnectionstatechange: PeerEventHandler = null;
	onsignalingstatechange: PeerEventHandler = null;
	onicegatheringstatechange: PeerEventHandler = null;
	onnegotiationneeded: PeerEventHandler = null;

	constructor(config: RTCConfiguration = {}) {
		super();

		const scopedConfig = config as ScopedRtcConfiguration;
		this.nativeScopeId =
			typeof scopedConfig.__chelysRuntimeScope === 'string'
				? scopedConfig.__chelysRuntimeScope
				: null;
		registerScopedPeer(this);

		const iceServers = (config.iceServers ?? []).map((server) => ({
			urls: Array.isArray(server.urls) ? server.urls : [server.urls],
			username: server.username,
			credential: server.credential,
		}));

		this.peerIdPromise = invoke<string>('rtc_create_peer', {
			config: {
				ice_servers: iceServers,
				scope_id: this.nativeScopeId,
			},
		})
			.then((id: string) => {
				if (this.retired) {
					knownPeerHandles.add(id);
					void invoke('rtc_close_peer', { peerId: id }).catch(() => undefined);
					return id;
				}

				this.peerId = id;
				knownPeerHandles.add(id);
				peerByHandle.set(id, this);

				const queued = pendingPeerEvents.get(id);
				if (queued) {
					pendingPeerEvents.delete(id);
					for (const event of queued) this.emit(event.type, event.payload);
				}
				return id;
			})
			.catch((error: unknown) => {
				unregisterScopedPeer(this);
				throw error;
			});
	}

	emit(type: string, payload: unknown): void {
		if (this.retired) return;
		switch (type) {
			case 'icecandidate':
				this.emitIceCandidate(payload);
				break;
			case 'iceconnectionstatechange': {
				const state = stateName(payload) as RTCIceConnectionState;
				this.iceConnectionState = state;
				if (state === 'connected' || state === 'completed') {
					setScopedPeerConnected(this, true);
				} else if (
					state === 'disconnected' ||
					state === 'failed' ||
					state === 'closed'
				) {
					setScopedPeerConnected(this, false);
				}
				this.emitEvent(
					'iceconnectionstatechange',
					this.oniceconnectionstatechange,
				);
				break;
			}
			case 'connectionstatechange': {
				const state = stateName(payload) as RTCPeerConnectionState;
				this.connectionState = state;
				setScopedPeerConnected(this, state === 'connected');
				this.emitEvent('connectionstatechange', this.onconnectionstatechange);
				break;
			}
			case 'signalingstatechange':
				this.signalingState = stateName(payload) as RTCSignalingState;
				this.emitEvent('signalingstatechange', this.onsignalingstatechange);
				break;
			case 'datachannel':
				this.emitDataChannel(payload as DataChannelPayload);
				break;
		}
	}

	retireAfterScopeReset(): void {
		this.retired = true;
		setScopedPeerConnected(this, false);
		this.retireChannels();
		if (this.peerId) {
			peerByHandle.delete(this.peerId);
			pendingPeerEvents.delete(this.peerId);
			knownPeerHandles.add(this.peerId);
		}
		unregisterScopedPeer(this);
	}

	private emitIceCandidate(payload: unknown): void {
		const candidate = payload
			? new TauriRTCIceCandidate(payload as Partial<RTCIceCandidateInit>)
			: null;
		const event = new Event('icecandidate') as RTCPeerConnectionIceEvent;
		Object.defineProperty(event, 'candidate', { value: candidate });
		this.onicecandidate?.call(this, event);
		this.dispatchEvent(event);
	}

	private emitDataChannel(payload: DataChannelPayload): void {
		this.channelIds.add(payload.channelId);
		const channel = new TauriRTCDataChannel(
			payload.channelId,
			payload.label,
			payload.ordered,
			payload.protocol,
		);
		registerChannel(payload.channelId, channel);

		const event = new Event('datachannel') as RTCDataChannelEvent;
		Object.defineProperty(event, 'channel', { value: channel });
		this.ondatachannel?.call(this, event);
		this.dispatchEvent(event);
	}

	private emitEvent(type: string, handler: PeerEventHandler): void {
		const event = new Event(type);
		handler?.call(this, event);
		this.dispatchEvent(event);
	}

	private async pid(): Promise<string> {
		return this.peerId ?? this.peerIdPromise;
	}

	private async invokePeer<TResult = void>(
		command: string,
		args: Record<string, unknown> = {},
	): Promise<TResult> {
		const peerId = await this.pid();
		try {
			return await invoke<TResult>(command, { peerId, ...args });
		} catch (error) {
			throw new Error(`${command} failed: ${toError(error).message}`);
		}
	}

	private fireNegotiationNeeded(): void {
		this.emitEvent('negotiationneeded', this.onnegotiationneeded);
	}

	async createOffer(
		_options?: RTCOfferOptions,
	): Promise<TauriRTCSessionDescription> {
		await this.pendingChannelOps;
		const result = await this.invokePeer<{ type: string; sdp: string }>(
			'rtc_create_offer',
		);
		return new TauriRTCSessionDescription(result.type, result.sdp);
	}

	async createAnswer(
		_options?: RTCAnswerOptions,
	): Promise<TauriRTCSessionDescription> {
		await this.pendingChannelOps;
		const result = await this.invokePeer<{ type: string; sdp: string }>(
			'rtc_create_answer',
		);
		return new TauriRTCSessionDescription(result.type, result.sdp);
	}

	async setLocalDescription(
		description: RTCSessionDescriptionInit,
	): Promise<void> {
		const dto = { type: description.type, sdp: description.sdp ?? '' };
		await this.invokePeer('rtc_set_local_description', { sdp: dto });
		this.localDescription = new TauriRTCSessionDescription(dto.type, dto.sdp);
	}

	async setRemoteDescription(
		description: RTCSessionDescriptionInit,
	): Promise<void> {
		const dto = { type: description.type, sdp: description.sdp ?? '' };
		await this.invokePeer('rtc_set_remote_description', { sdp: dto });
		this.remoteDescription = new TauriRTCSessionDescription(dto.type, dto.sdp);
	}

	async addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void> {
		if (!candidate?.candidate || /\.local\b/i.test(candidate.candidate)) return;

		await this.invokePeer('rtc_add_ice_candidate', {
			candidate: {
				candidate: candidate.candidate,
				sdpMid: candidate.sdpMid ?? null,
				sdpMLineIndex: candidate.sdpMLineIndex ?? null,
				usernameFragment: candidate.usernameFragment ?? null,
			},
		});
	}

	createDataChannel(
		label: string,
		init?: RTCDataChannelInit,
	): TauriRTCDataChannel {
		const channelId = crypto.randomUUID();
		this.channelIds.add(channelId);
		const channel = new TauriRTCDataChannel(
			channelId,
			label,
			init?.ordered ?? true,
			init?.protocol ?? '',
		);
		registerChannel(channelId, channel);

		const operation = this.pendingChannelOps.then(() =>
			this.invokePeer('rtc_create_data_channel', {
				channelId,
				label,
				init: init
					? {
							ordered: init.ordered,
							max_packet_life_time: init.maxPacketLifeTime,
							max_retransmits: init.maxRetransmits,
							protocol: init.protocol,
							negotiated: init.negotiated,
							id: init.id,
						}
					: null,
			}),
		);
		this.pendingChannelOps = operation.catch(() => undefined);

		void operation.then(
			() => {
				if (init?.negotiated) return;
				setTimeout(() => this.fireNegotiationNeeded(), 0);
			},
			(error) => {
				console.warn(`[peer] failed to create data channel ${label}:`, error);
				channel.fail(error);
				channelByHandle.delete(channelId);
				this.channelIds.delete(channelId);
			},
		);

		return channel;
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;

		this.closePromise = this.closePeer().finally(() => {
			this.connectionState = 'closed';
			this.signalingState = 'closed';
			setScopedPeerConnected(this, false);
			this.emitEvent('connectionstatechange', this.onconnectionstatechange);
			unregisterScopedPeer(this);
		});
		return this.closePromise;
	}

	private async closePeer(): Promise<void> {
		let peerId: string;
		try {
			peerId = await this.pid();
		} catch {
			this.retireChannels();
			return;
		}

		peerByHandle.delete(peerId);
		pendingPeerEvents.delete(peerId);
		knownPeerHandles.add(peerId);
		try {
			await invoke('rtc_close_peer', { peerId });
		} catch (error) {
			console.warn(`[rtc] failed to close peer ${peerId}:`, error);
		} finally {
			this.retireChannels();
		}
	}

	private retireChannels(): void {
		for (const channelId of this.channelIds) {
			const channel = channelByHandle.get(channelId);
			if (channel && channel.readyState !== 'closed') {
				channel.emit('close', null);
			}
			channelByHandle.delete(channelId);
			pendingChannelEvents.delete(channelId);
		}
		this.channelIds.clear();
	}

	async getStats(): Promise<Map<string, unknown>> {
		const stats = new Map<string, unknown>();
		if (this.connectionState !== 'connected') return stats;

		stats.set('cp', {
			id: 'cp',
			type: 'candidate-pair',
			state: 'succeeded',
			selected: true,
			nominated: true,
			localCandidateId: 'lc',
			remoteCandidateId: 'rc',
		});
		stats.set('lc', {
			id: 'lc',
			type: 'local-candidate',
			address: '127.0.0.1',
			port: 0,
			protocol: 'udp',
			candidateType: 'host',
		});
		stats.set('rc', {
			id: 'rc',
			type: 'remote-candidate',
			address: '127.0.0.1',
			port: 0,
			protocol: 'udp',
			candidateType: 'host',
		});
		return stats;
	}

	addTransceiver(): never {
		throw new Error('addTransceiver not supported');
	}

	addTrack(): never {
		throw new Error('addTrack not supported');
	}
}
