// src/webrtc-polyfill/index.ts
import { listen } from "@tauri-apps/api/event";

import {
    TauriRTCPeerConnection,
    dispatchPeerEvent,
    dispatchChannelEvent,
} from "./RTCPeerConnection";
import { TauriRTCDataChannel } from "./RTCDataChannel";

export async function installWebRtcPolyfill(): Promise<void> {
    (globalThis as any).RTCPeerConnection = TauriRTCPeerConnection;
    (globalThis as any).RTCDataChannel = TauriRTCDataChannel;

    (globalThis as any).RTCSessionDescription = class {
        type: string;
        sdp: string;
        constructor(init: any) {
            this.type = init.type;
            this.sdp = init.sdp;
        }
    };

    (globalThis as any).RTCIceCandidate = class {
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
    };

    await listen<{ peer_id: string; type: string; payload: unknown }>("rtc-peer", (e) => {
        dispatchPeerEvent(e.payload.peer_id, e.payload.type, e.payload.payload);
    });

    await listen<{ channel_id: string; type: string; payload: unknown }>("rtc-channel", (e) => {
        dispatchChannelEvent(e.payload.channel_id, e.payload.type, e.payload.payload);
    });
}