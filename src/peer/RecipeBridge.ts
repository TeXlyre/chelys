// src/peer/RecipeBridge.ts
import { getAccountControlUser } from '@chelys/peer/AccountControlRoom';
import {
	acquireRendezvous,
	type RendezvousLease,
} from '@chelys/peer/RendezvousRoom';
import {
	HOST_PROBE_MESSAGE,
	HOST_READY_MESSAGE,
} from '@chelys/peer/SessionContract';
import { SessionHostRegistry } from '@chelys/peer/SessionHostRegistry';
import type {
	HostTransport,
	TransportConfig,
	TransportPayload,
} from '@chelys/types/transport';
import {
	chelysAccountSyncService,
	type ChelysAccountConnection,
} from '@texlyre/services/ChelysAccountSyncService';
import { getActiveAccountId } from '../plugin-host/activeAccount';
import {
	resolveSignalingServers,
	resolveTransportRoomId,
} from './BridgeResolution';

export interface RecipeBridgeOptions {
	recipeId: string;
	label: string;
	roomId: string;
	accountRoomId?: string;
	sharedRendezvous: boolean;
	signaling: string[];
	targetUrl: string;
}

const toSocketData = (payload: TransportPayload): string | ArrayBuffer => {
	if (typeof payload === 'string') return payload;
	const buffer = new ArrayBuffer(payload.byteLength);
	new Uint8Array(buffer).set(payload);
	return buffer;
};

export class RecipeBridge {
	private sessionHosts: SessionHostRegistry | null = null;
	private sessionConnection: ChelysAccountConnection | null = null;
	private sharedRendezvous: RendezvousLease | null = null;
	private unsubscribeSharedRendezvous: (() => void) | null = null;
	private unsubscribeAccount: (() => void) | null = null;
	private readonly sockets = new Set<WebSocket>();

	constructor(private readonly options: RecipeBridgeOptions) {}

	start(): void {
		if (this.sessionHosts || this.sharedRendezvous || this.unsubscribeAccount) {
			return;
		}

		if (this.options.sharedRendezvous) {
			const rendezvous = acquireRendezvous(
				this.options.roomId,
				this.options.signaling,
				getAccountControlUser(),
			);
			this.sharedRendezvous = rendezvous;
			this.unsubscribeSharedRendezvous = rendezvous.subscribe((connection) => {
				this.sessionHosts?.stop();
				const sessionHosts = new SessionHostRegistry({
					connection,
					baseRoomId: this.options.roomId,
					label: this.options.label,
					signaling: this.options.signaling,
					onChannel: (channel) => this.attach(channel),
				});
				sessionHosts.start();
				this.sessionHosts = sessionHosts;
			});
			return;
		}

		if (this.options.accountRoomId) {
			this.unsubscribeAccount = chelysAccountSyncService.subscribe(
				(connection) => {
					const usable =
						connection?.roomId === this.options.accountRoomId
							? connection
							: null;
					if (usable === this.sessionConnection) return;
					this.sessionHosts?.stop();
					this.sessionHosts = null;
					this.sessionConnection = usable;
					if (!usable) return;
					const sessionHosts = new SessionHostRegistry({
						connection: usable,
						baseRoomId: this.options.roomId,
						label: this.options.label,
						signaling: this.options.signaling,
						onChannel: (channel) => this.attach(channel),
					});
					sessionHosts.start();
					this.sessionHosts = sessionHosts;
				},
			);
			return;
		}

		console.warn(
			`[RecipeBridge] ${this.options.label}: no awareness control room is available`,
		);
	}

	stop(): void {
		for (const socket of this.sockets) socket.close();
		this.sockets.clear();
		this.unsubscribeAccount?.();
		this.unsubscribeAccount = null;
		this.unsubscribeSharedRendezvous?.();
		this.unsubscribeSharedRendezvous = null;
		this.sessionHosts?.stop();
		this.sessionHosts = null;
		this.sessionConnection = null;
		this.sharedRendezvous?.release();
		this.sharedRendezvous = null;
	}

	private attach(channel: HostTransport): void {
		const reusableBackend = this.options.label.startsWith('typesetter:');
		let socket: WebSocket | null = null;
		let socketReceivedResponse = false;
		let closed = false;
		const outbound: Array<string | ArrayBuffer> = [];

		const closeSocket = (): void => {
			const current = socket;
			socket = null;
			if (!current) return;
			this.sockets.delete(current);
			if (
				current.readyState === WebSocket.OPEN ||
				current.readyState === WebSocket.CONNECTING
			) {
				current.close();
			}
		};

		const closeChannel = (): void => {
			if (closed) return;
			closed = true;
			outbound.length = 0;
			closeSocket();
			channel.close();
		};

		const sendToSocket = (
			current: WebSocket,
			data: string | ArrayBuffer,
		): boolean => {
			try {
				current.send(data);
				return true;
			} catch (error) {
				console.error(
					`[RecipeBridge] socket send failed for ${this.options.recipeId}`,
					error,
				);
				return false;
			}
		};

		const openSocket = (): void => {
			if (
				closed ||
				socket?.readyState === WebSocket.OPEN ||
				socket?.readyState === WebSocket.CONNECTING
			) {
				return;
			}
			const current = new WebSocket(this.options.targetUrl);
			current.binaryType = 'arraybuffer';
			socket = current;
			socketReceivedResponse = false;
			this.sockets.add(current);

			current.addEventListener('open', () => {
				if (closed || socket !== current) return;
				while (outbound.length > 0) {
					const message = outbound.shift();
					if (message !== undefined && !sendToSocket(current, message)) {
						closeChannel();
						return;
					}
				}
			});

			current.addEventListener('message', (event) => {
				if (closed || socket !== current) return;
				socketReceivedResponse = true;
				channel.send(
					typeof event.data === 'string'
						? event.data
						: new Uint8Array(event.data as ArrayBuffer),
				);
			});

			current.addEventListener('close', () => {
				this.sockets.delete(current);
				if (socket !== current || closed) return;
				socket = null;
				if (reusableBackend && socketReceivedResponse && channel.isOpen) {
					if (outbound.length > 0) openSocket();
					return;
				}
				closeChannel();
			});

			current.addEventListener('error', () => {
				console.error(
					`[RecipeBridge] socket error for ${this.options.recipeId}`,
				);
			});
		};

		channel.onMessage((payload) => {
			if (closed) return;
			if (payload === HOST_PROBE_MESSAGE) {
				channel.send(HOST_READY_MESSAGE);
				return;
			}
			const data = toSocketData(payload);
			const current = socket;
			if (current?.readyState === WebSocket.OPEN) {
				if (!sendToSocket(current, data)) closeChannel();
				return;
			}
			outbound.push(data);
			openSocket();
		});

		channel.onClose(() => {
			if (closed) return;
			closed = true;
			outbound.length = 0;
			closeSocket();
		});

		openSocket();
		channel.send(HOST_READY_MESSAGE);
	}
}

export function bridgeOptionsFromConfig(
	recipeId: string,
	configId: string,
	label: string,
	config: TransportConfig,
): RecipeBridgeOptions | null {
	if (config.type !== 'webrtc') return null;
	if (!config.url) {
		console.warn(`[RecipeBridge] ${label}: transportUrl is missing`);
		return null;
	}

	const explicitRoomId =
		typeof config.roomId === 'string' && config.roomId.trim().length > 0;
	const roomId = resolveTransportRoomId(configId, config.roomId);
	if (!roomId) {
		console.warn(`[RecipeBridge] ${label}: no Chelys room is available`);
		return null;
	}

	const signaling = resolveSignalingServers(config.signaling);
	if (signaling.length === 0) {
		console.warn(`[RecipeBridge] ${label}: no signaling servers configured`);
		return null;
	}

	return {
		recipeId,
		label,
		roomId,
		accountRoomId: explicitRoomId
			? undefined
			: (getActiveAccountId() ?? undefined),
		sharedRendezvous: explicitRoomId,
		signaling,
		targetUrl: config.url,
	};
}
