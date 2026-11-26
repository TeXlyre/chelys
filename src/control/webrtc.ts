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
import { accessPolicy, keyHash } from './policy';
import {
	acquireRendezvous,
	type RendezvousLease,
} from '@chelys/peer/RendezvousRoom';
import { resolveSignalingServers } from '../peer/BridgeResolution';
import {
	controlKey,
	dedicatedRoom,
	DEDICATED_LABEL,
	CONTROL_HELLO,
	newChallenge,
	seal,
	unseal,
	validApiKey,
	MAX_RESPONSE,
} from './dedicated';
import { chelysControl } from './commands';
import {
	CONTROL_LABEL_PREFIX,
	handleRpc,
	getInstanceId,
	commandTimeout,
} from './protocol';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class RemoteControlHost {
	private unsubscribeAccount: (() => void) | null = null;
	private unsubscribePolicy: (() => void) | null = null;
	private connection: ChelysAccountConnection | null = null;
	private registry: SessionHostRegistry | null = null;
	private dedicated = new Map<
		string,
		{
			lease: RendezvousLease;
			unsubscribe: () => void;
			registry: SessionHostRegistry | null;
			hash: string;
			signaling: string;
		}
	>();
	private generation = 0;
	private readonly settingsChanged = (event: Event) => {
		if ((event as CustomEvent).detail?.id === 'collabSignalingServers')
			this.reconcileDedicated();
	};

	start(): void {
		if (this.unsubscribeAccount) return;
		this.unsubscribeAccount = chelysAccountSyncService.subscribe(
			(connection) => {
				this.connection = connection;
				this.reconcileAccount();
			},
		);
		this.unsubscribePolicy = accessPolicy.subscribe(() => {
			this.reconcileAccount();
			this.reconcileDedicated();
		});
		this.reconcileDedicated();
		window.addEventListener('chelys-settings-changed', this.settingsChanged);
	}
	stop(): void {
		this.unsubscribeAccount?.();
		this.unsubscribePolicy?.();
		this.unsubscribeAccount = null;
		this.unsubscribePolicy = null;
		this.registry?.stop();
		this.registry = null;
		this.connection = null;
		window.removeEventListener('chelys-settings-changed', this.settingsChanged);
		this.stopDedicated();
	}

	private reconcileAccount(): void {
		this.registry?.stop();
		this.registry = null;
		const connection = this.connection;
		if (!connection || accessPolicy.mode() === 'disabled') return;
		const registry = new SessionHostRegistry({
			connection,
			baseRoomId: connection.roomId,
			label: CONTROL_LABEL_PREFIX + getInstanceId(),
			signaling: readSignalingServers(connection.userId),
			allowChelysRequesters: true,
			onChannel: (channel) => this.attach(connection, channel),
		});
		this.registry = registry;
		registry.start();
	}

	private stopDedicated(): void {
		this.generation++;
		for (const entry of this.dedicated.values()) {
			entry.unsubscribe();
			entry.registry?.stop();
			entry.lease.release();
		}
		this.dedicated.clear();
	}

	private reconcileDedicated(): void {
		const generation = ++this.generation;
		void this.startDedicated(generation).catch((error) => {
			if (generation === this.generation)
				console.warn(
					'[Chelys] Dedicated control unavailable:',
					error instanceof Error ? error.message : String(error),
				);
		});
	}

	private async startDedicated(generation: number): Promise<void> {
		const signaling = resolveSignalingServers();
		const signature = JSON.stringify(signaling);
		const records = signaling.length ? accessPolicy.dedicatedKeys() : [];
		for (const [id, entry] of this.dedicated) {
			if (
				entry.signaling === signature &&
				records.some((record) => record.id === id && record.hash === entry.hash)
			)
				continue;
			this.dedicated.delete(id);
			entry.unsubscribe();
			entry.registry?.stop();
			entry.lease.release();
		}
		for (const record of records) {
			if (this.dedicated.has(record.id)) continue;
			const room = await dedicatedRoom(record.hash);
			const key = await controlKey(record.hash);
			if (generation !== this.generation) return;
			// A listening room is healthy even when no client is connected.
			const lease = acquireRendezvous(room, signaling, undefined, {
				recoverPeerless: false,
			});
			const entry = {
				lease,
				unsubscribe: () => {},
				registry: null as SessionHostRegistry | null,
				hash: record.hash,
				signaling: signature,
			};
			this.dedicated.set(record.id, entry);
			entry.unsubscribe = lease.subscribe((connection) => {
				entry.registry?.stop();
				if (this.dedicated.get(record.id) !== entry) return;
				entry.registry = new SessionHostRegistry({
					connection,
					baseRoomId: room,
					label: DEDICATED_LABEL,
					signaling,
					allowChelysRequesters: true,
					recoverPeerless: false,
					onChannel: (channel) =>
						this.attachDedicated(channel, record.id, record.hash, key),
				});
				entry.registry.start();
			});
		}
	}

	private attachDedicated(
		channel: HostTransport,
		id: string,
		hash: string,
		key: CryptoKey,
	): void {
		const challenge = newChallenge();
		let state: 'hello' | 'request' | 'finished' = 'hello';
		let timer = setTimeout(() => channel.close(), 30_000);
		channel.onClose(() => clearTimeout(timer));
		channel.onMessage((payload) => {
			const raw =
				typeof payload === 'string' ? payload : decoder.decode(payload);
			if (state === 'hello' && raw === CONTROL_HELLO) {
				state = 'request';
				channel.send(challenge);
				return;
			}
			if (state !== 'request') {
				channel.close();
				return;
			}
			state = 'finished';
			void (async () => {
				const message = await unseal(key, challenge, 'request', raw);
				const response = await handleRpc(message, async (request) => {
					if (
						!validApiKey(request.apiKey) ||
						(await keyHash(request.apiKey)) !== hash ||
						!accessPolicy
							.dedicatedKeys()
							.some((record) => record.id === id && record.hash === hash)
					)
						throw new Error('Invalid or revoked dedicated API key');
					clearTimeout(timer);
					timer = setTimeout(
						() => channel.close(),
						commandTimeout(request.method) + 5_000,
					);
					return chelysControl.execute(request, {
						transport: 'webrtc',
						dedicated: true,
						apiKey: request.apiKey,
					});
				});
				let text = JSON.stringify(response);
				if (text.length > MAX_RESPONSE)
					text = JSON.stringify({
						v: 1,
						id: response.id,
						ok: false,
						error: 'Response too large',
					});
				channel.send(await seal(key, challenge, 'response', text));
			})().catch(() => channel.close());
		});
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
