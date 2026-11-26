// src/control/webrtc.ts
import {
	chelysAccountSyncService,
	type ChelysAccountConnection,
} from '@texlyre/services/ChelysAccountSyncService';
import { SessionHostRegistry } from '@chelys/peer/SessionHostRegistry';
import {
	readPeerState,
	isSessionRequest,
	SESSIONS_MAP_NAME,
} from '@chelys/peer/SessionContract';
import type { HostTransport } from '@chelys/types/transport';
import { readSignalingServers } from '@chelys/peer/TransportResolution';
import { accessPolicy } from './policy';
import { chelysControl } from './commands';
import { CONTROL_LABEL_PREFIX, handleRpc, getInstanceId } from './protocol';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class RemoteControlHost {
	private unsubscribeAccount: (() => void) | null = null;
	private unsubscribePolicy: (() => void) | null = null;
	private connection: ChelysAccountConnection | null = null;
	private registry: SessionHostRegistry | null = null;

	start(): void {
		if (this.unsubscribeAccount) return;
		this.unsubscribeAccount = chelysAccountSyncService.subscribe(
			(connection) => {
				this.connection = connection;
				this.reconcile();
			},
		);
		this.unsubscribePolicy = accessPolicy.subscribe(() => this.reconcile());
	}
	stop(): void {
		this.unsubscribeAccount?.();
		this.unsubscribePolicy?.();
		this.unsubscribeAccount = null;
		this.unsubscribePolicy = null;
		this.registry?.stop();
		this.registry = null;
		this.connection = null;
	}

	private reconcile(): void {
		this.registry?.stop();
		this.registry = null;
		const connection = this.connection;
		if (!connection || accessPolicy.mode() === 'disabled') return;
		const registry = new SessionHostRegistry({
			connection,
			baseRoomId: connection.roomId,
			label: CONTROL_LABEL_PREFIX + getInstanceId(),
			signaling: readSignalingServers(connection.userId),
			onChannel: (channel) => this.attach(connection, channel),
		});
		this.registry = registry;
		registry.start();
	}

	private peerKind(
		connection: ChelysAccountConnection,
		channel: HostTransport,
	): 'chelys' | 'texlyre' | null {
		const requests = connection.doc.getMap<unknown>(SESSIONS_MAP_NAME);
		let matched: 'chelys' | 'texlyre' | null = null;
		requests.forEach((value) => {
			if (!isSessionRequest(value)) return;
			if (
				value.requesterSessionTransportPeerId !== channel.peerId ||
				value.targetHostInstanceId !== connection.peer.instanceId ||
				value.label !== CONTROL_LABEL_PREFIX + getInstanceId() ||
				value.status !== 'ready'
			)
				return;
			for (const state of connection.awareness.getStates().values()) {
				const peer = readPeerState(state);
				if (
					peer &&
					peer.id === value.requesterPeerId &&
					peer.instanceId === value.requesterInstanceId &&
					peer.transportPeerId === value.requesterTransportPeerId
				)
					matched = peer.kind;
			}
		});
		return matched;
	}

	private attach(
		connection: ChelysAccountConnection,
		channel: HostTransport,
	): void {
		channel.onMessage((payload) => {
			const raw =
				typeof payload === 'string' ? payload : decoder.decode(payload);
			if (raw.length > 65_536) {
				channel.close();
				return;
			}
			void handleRpc(raw, async (request) => {
				const kind = this.peerKind(connection, channel);
				if (!kind) throw new Error('Unverified WebRTC requester');
				return chelysControl.execute(request, {
					transport: 'webrtc',
					peerKind: kind,
					apiKey: request.apiKey,
				});
			}).then((response) => {
				const message = JSON.stringify(response);
				if (message.length <= 512_000) channel.send(encoder.encode(message));
				else
					channel.send(
						encoder.encode(
							JSON.stringify({
								v: 1,
								id: response.id,
								ok: false,
								error: 'Response too large',
							}),
						),
					);
			});
		});
	}
}
export const remoteControlHost = new RemoteControlHost();
