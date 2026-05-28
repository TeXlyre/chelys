// src/webrtc-polyfill/RTCPeerConnection.ts
import { invoke } from "@tauri-apps/api/core";

import { collabService } from "@texlyre/services/CollabService";
import { TauriRTCDataChannel } from "./RTCDataChannel";

const peerByHandle = new Map<string, TauriRTCPeerConnection>();
const channelByHandle = new Map<string, TauriRTCDataChannel>();
const pendingChannelEvents = new Map<string, Array<{ type: string; payload: unknown }>>();

const PEER_RESET_COOLDOWN_MS = 3_000;
const SIGNALING_DRAIN_MS = 300;
const AWARENESS_TIMEOUT_MS = 30_000;
const RECONNECT_DELAY_MS = 2_000;

interface RoomSnapshot {
    roomName: string;
    doc: any;
    signaling?: string[];
}

let peerLayerResetInFlight = false;
let lastPeerLayerResetAt = 0;

function containers(): Map<string, any> | undefined {
    return (collabService as unknown as { docContainers?: Map<string, any> }).docContainers;
}

function snapshotWebrtcRooms(): RoomSnapshot[] {
    const out: RoomSnapshot[] = [];
    const map = containers();
    if (!map) return out;

    for (const [roomName, container] of map) {
        if (!container?.provider) continue;
        if (container.providerType !== "webrtc") continue;
        out.push({
            roomName,
            doc: container.doc,
            signaling: container.provider.signalingUrls,
        });
    }
    return out;
}

function resetPeerLayerAfterDisconnect(): void {
    if (peerLayerResetInFlight) return;
    if (Date.now() - lastPeerLayerResetAt < PEER_RESET_COOLDOWN_MS) return;

    lastPeerLayerResetAt = Date.now();
    peerLayerResetInFlight = true;

    const rooms = snapshotWebrtcRooms();
    const peers = Array.from(peerByHandle.values());

    void Promise.allSettled(peers.map((peer) => peer.close()))
        .catch(() => { })
        .finally(() => {
            void rebuildProviders(rooms).finally(() => {
                peerLayerResetInFlight = false;
                lastPeerLayerResetAt = Date.now() - (PEER_RESET_COOLDOWN_MS - 1_000);
            });
        });
}

async function rebuildProviders(rooms: RoomSnapshot[]): Promise<void> {
    if (rooms.length === 0) return;

    let YWebrtc: any;
    let YAwareness: any;
    try {
        YWebrtc = await import("y-webrtc");
        YAwareness = await import("y-protocols/awareness");
    } catch (error) {
        console.warn("[peer] failed to load y-webrtc for rebuild:", error);
        return;
    }

    const map = containers();
    if (!map) return;

    for (const room of rooms) {
        const container = map.get(room.roomName);
        if (!container?.provider) continue;

        const userState = container.provider.awareness?.getLocalState?.() ?? null;

        try {
            container.provider.disconnect?.();
            container.provider.destroy?.();
        } catch (error) {
            console.warn("[peer] error destroying provider for", room.roomName, error);
        }

        await new Promise((r) => setTimeout(r, SIGNALING_DRAIN_MS));

        const provider = await createProvider(YWebrtc, room);
        if (!provider) {
            console.warn("[peer] gave up rebuilding provider for", room.roomName);
            continue;
        }

        container.provider = provider;
        restoreUserState(provider, userState);
        attachAwarenessTimeout(provider, YAwareness);
        attachAutoReconnect(provider, map, room.roomName);
    }
}

async function createProvider(YWebrtc: any, room: RoomSnapshot): Promise<any> {
    for (let attempt = 0; attempt < 40; attempt++) {
        try {
            return new YWebrtc.WebrtcProvider(room.roomName, room.doc, {
                signaling: room.signaling ?? [],
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes("already exists")) {
                await new Promise((r) => setTimeout(r, 50));
                continue;
            }
            console.warn("[peer] error rebuilding provider for", room.roomName, error);
            return null;
        }
    }
    return null;
}

function restoreUserState(provider: any, userState: any): void {
    if (!provider.awareness || !userState?.user) return;
    for (const [field, value] of Object.entries(userState)) {
        provider.awareness.setLocalStateField(field, value);
    }
}

function attachAwarenessTimeout(provider: any, YAwareness: any): void {
    if (!provider.awareness || !YAwareness?.removeAwarenessStates) return;

    provider.awareness.on("update", () => {
        const now = Date.now();
        provider.awareness.getStates().forEach((state: any, clientId: number) => {
            if (
                clientId !== provider.awareness.clientID &&
                state.lastSeen &&
                now - state.lastSeen > AWARENESS_TIMEOUT_MS
            ) {
                YAwareness.removeAwarenessStates(provider.awareness, [clientId], "timeout");
            }
        });
    });
}

function attachAutoReconnect(provider: any, map: Map<string, any>, roomName: string): void {
    provider.on?.("status", (event: { connected?: boolean; status?: string }) => {
        const isDisconnected = event.connected === false || event.status === "disconnected";
        if (!isDisconnected || map.get(roomName)?.provider !== provider) return;

        setTimeout(() => {
            if (map.get(roomName)?.provider === provider) {
                provider.connect?.();
            }
        }, RECONNECT_DELAY_MS);
    });
}

export function dispatchChannelEvent(channelId: string, type: string, payload: unknown): void {
    const ch = channelByHandle.get(channelId);
    if (ch) {
        ch.emit(type, payload);
        return;
    }

    const queued = pendingChannelEvents.get(channelId) ?? [];
    queued.push({ type, payload });
    pendingChannelEvents.set(channelId, queued);
}

export function registerChannel(channelId: string, ch: TauriRTCDataChannel): void {
    channelByHandle.set(channelId, ch);

    const queued = pendingChannelEvents.get(channelId);
    if (queued) {
        pendingChannelEvents.delete(channelId);

        for (const e of queued) {
            ch.emit(e.type, e.payload);
        }
    }
}

export function dispatchPeerEvent(peerId: string, type: string, payload: unknown): void {
    peerByHandle.get(peerId)?.emit(type, payload);
}

class TauriRTCSessionDescription {
    constructor(public type: string, public sdp: string) { }

    toJSON() {
        return {
            type: this.type,
            sdp: this.sdp,
        };
    }
}

class TauriRTCIceCandidate {
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number | null;
    usernameFragment: string | null;

    constructor(init: any) {
        this.candidate = init.candidate ?? "";
        this.sdpMid = init.sdpMid ?? null;
        this.sdpMLineIndex = init.sdpMLineIndex ?? null;
        this.usernameFragment = init.usernameFragment ?? null;
    }

    toJSON() {
        return {
            candidate: this.candidate,
            sdpMid: this.sdpMid,
            sdpMLineIndex: this.sdpMLineIndex,
            usernameFragment: this.usernameFragment,
        };
    }
}

export class TauriRTCPeerConnection extends EventTarget {
    private peerId: string | null = null;
    private peerIdPromise: Promise<string>;
    private pendingChannelOps: Promise<unknown> = Promise.resolve();

    iceConnectionState = "new";
    connectionState = "new";
    signalingState = "stable";
    iceGatheringState = "new";
    localDescription: TauriRTCSessionDescription | null = null;
    remoteDescription: TauriRTCSessionDescription | null = null;

    onicecandidate: ((this: TauriRTCPeerConnection, ev: any) => any) | null = null;
    ondatachannel: ((this: TauriRTCPeerConnection, ev: any) => any) | null = null;
    oniceconnectionstatechange: ((this: TauriRTCPeerConnection, ev: Event) => any) | null = null;
    onconnectionstatechange: ((this: TauriRTCPeerConnection, ev: Event) => any) | null = null;
    onsignalingstatechange: ((this: TauriRTCPeerConnection, ev: Event) => any) | null = null;
    onicegatheringstatechange: ((this: TauriRTCPeerConnection, ev: Event) => any) | null = null;
    onnegotiationneeded: ((this: TauriRTCPeerConnection, ev: Event) => any) | null = null;

    constructor(config: RTCConfiguration = {}) {
        super();

        const iceServers = (config.iceServers ?? []).map((s: any) => ({
            urls: Array.isArray(s.urls) ? s.urls : [s.urls],
            username: s.username,
            credential: s.credential,
        }));

        this.peerIdPromise = invoke<string>("rtc_create_peer", {
            config: {
                ice_servers: iceServers,
            },
        }).then((id) => {
            this.peerId = id;
            peerByHandle.set(id, this);
            return id;
        });
    }

    emit(type: string, payload: unknown): void {
        if (type === "icecandidate") {
            const candidate = payload ? new TauriRTCIceCandidate(payload) : null;
            const ev: any = new Event("icecandidate");
            ev.candidate = candidate;

            this.onicecandidate?.(ev);
            this.dispatchEvent(ev);
        } else if (type === "iceconnectionstatechange") {
            this.iceConnectionState = payload as string;

            if (
                this.iceConnectionState === "disconnected" ||
                this.iceConnectionState === "failed"
            ) {
                resetPeerLayerAfterDisconnect();
            }

            const ev = new Event("iceconnectionstatechange");
            this.oniceconnectionstatechange?.(ev);
            this.dispatchEvent(ev);
        } else if (type === "connectionstatechange") {
            this.connectionState = payload as string;

            if (this.connectionState === "failed" && this.peerId) {
                peerByHandle.delete(this.peerId);
            }

            if (
                this.connectionState === "disconnected" ||
                this.connectionState === "failed"
            ) {
                resetPeerLayerAfterDisconnect();
            }

            const ev = new Event("connectionstatechange");
            this.onconnectionstatechange?.(ev);
            this.dispatchEvent(ev);
        } else if (type === "signalingstatechange") {
            this.signalingState = payload as string;

            const ev = new Event("signalingstatechange");
            this.onsignalingstatechange?.(ev);
            this.dispatchEvent(ev);
        } else if (type === "datachannel") {
            const p = payload as {
                channelId: string;
                label: string;
                ordered: boolean;
                protocol: string;
            };

            const channel = new TauriRTCDataChannel(
                p.channelId,
                p.label,
                p.ordered,
                p.protocol,
            );

            registerChannel(p.channelId, channel);

            const ev: any = new Event("datachannel");
            ev.channel = channel;

            this.ondatachannel?.(ev);
            this.dispatchEvent(ev);
        }
    }

    private async pid(): Promise<string> {
        return this.peerId ?? (await this.peerIdPromise);
    }

    private fireNegotiationNeeded(): void {
        const ev = new Event("negotiationneeded");
        this.onnegotiationneeded?.(ev);
        this.dispatchEvent(ev);
    }

    async createOffer(_opts?: RTCOfferOptions): Promise<TauriRTCSessionDescription> {
        const peerId = await this.pid();
        await this.pendingChannelOps;

        try {
            const r = await invoke<{ type: string; sdp: string }>("rtc_create_offer", {
                peerId,
            });

            return new TauriRTCSessionDescription(r.type, r.sdp);
        } catch (e) {
            throw new Error(
                `createOffer failed: ${typeof e === "string" ? e : String(e)}`,
            );
        }
    }

    async createAnswer(_opts?: RTCAnswerOptions): Promise<TauriRTCSessionDescription> {
        const peerId = await this.pid();

        try {
            const r = await invoke<{ type: string; sdp: string }>("rtc_create_answer", {
                peerId,
            });

            return new TauriRTCSessionDescription(r.type, r.sdp);
        } catch (e) {
            throw new Error(
                `createAnswer failed: ${typeof e === "string" ? e : String(e)}`,
            );
        }
    }

    async setLocalDescription(sdp: any): Promise<void> {
        const peerId = await this.pid();
        const dto = {
            type: sdp.type,
            sdp: sdp.sdp,
        };

        try {
            await invoke("rtc_set_local_description", {
                peerId,
                sdp: dto,
            });

            this.localDescription = new TauriRTCSessionDescription(
                dto.type,
                dto.sdp,
            );
        } catch (e) {
            throw new Error(
                `setLocalDescription failed: ${typeof e === "string" ? e : String(e)}`,
            );
        }
    }

    async setRemoteDescription(sdp: any): Promise<void> {
        const peerId = await this.pid();
        const dto = {
            type: sdp.type,
            sdp: sdp.sdp,
        };

        try {
            await invoke("rtc_set_remote_description", {
                peerId,
                sdp: dto,
            });

            this.remoteDescription = new TauriRTCSessionDescription(
                dto.type,
                dto.sdp,
            );
        } catch (e) {
            throw new Error(
                `setRemoteDescription failed: ${typeof e === "string" ? e : String(e)}`,
            );
        }
    }

    async addIceCandidate(candidate: any): Promise<void> {
        if (!candidate || !candidate.candidate) return;
        if (/\.local\b/i.test(candidate.candidate)) return;

        const peerId = await this.pid();

        try {
            await invoke("rtc_add_ice_candidate", {
                peerId,
                candidate: {
                    candidate: candidate.candidate,
                    sdpMid: candidate.sdpMid ?? null,
                    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
                    usernameFragment: candidate.usernameFragment ?? null,
                },
            });
        } catch (e) {
            const msg = typeof e === "string" ? e : String(e);
            throw new Error(`addIceCandidate failed: ${msg}`);
        }
    }

    createDataChannel(label: string, init?: RTCDataChannelInit): TauriRTCDataChannel {
        const channelId = crypto.randomUUID();

        const channel = new TauriRTCDataChannel(
            channelId,
            label,
            init?.ordered ?? true,
            init?.protocol ?? "",
        );

        registerChannel(channelId, channel);

        const op = this.pid().then((peerId) =>
            invoke("rtc_create_data_channel", {
                peerId,
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

        this.pendingChannelOps = this.pendingChannelOps
            .then(() => op)
            .catch(() => { });

        op.then(() => setTimeout(() => this.fireNegotiationNeeded(), 0));

        return channel;
    }

    async close(): Promise<void> {
        const peerId = this.peerId;

        if (!peerId) return;

        peerByHandle.delete(peerId);

        try {
            await invoke("rtc_close_peer", {
                peerId,
            });
        } catch (error) {
            console.warn("[rtc] close failed:", peerId, error);
        }

        this.connectionState = "closed";
        this.signalingState = "closed";

        const ev = new Event("connectionstatechange");
        this.onconnectionstatechange?.(ev);
        this.dispatchEvent(ev);
    }

    async getStats(): Promise<Map<string, unknown>> {
        const map = new Map<string, unknown>();

        if (this.connectionState === "connected") {
            map.set("cp", {
                id: "cp",
                type: "candidate-pair",
                state: "succeeded",
                selected: true,
                nominated: true,
                localCandidateId: "lc",
                remoteCandidateId: "rc",
            });

            map.set("lc", {
                id: "lc",
                type: "local-candidate",
                address: "127.0.0.1",
                port: 0,
                protocol: "udp",
                candidateType: "host",
            });

            map.set("rc", {
                id: "rc",
                type: "remote-candidate",
                address: "127.0.0.1",
                port: 0,
                protocol: "udp",
                candidateType: "host",
            });
        }

        return map;
    }

    addTransceiver(): never {
        throw new Error("addTransceiver not supported");
    }

    addTrack(): never {
        throw new Error("addTrack not supported");
    }
}