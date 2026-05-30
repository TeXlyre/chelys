// src/webrtc-polyfill/install.ts
import { TauriRTCPeerConnection } from "./RTCPeerConnection";
import { TauriRTCDataChannel } from "./RTCDataChannel";

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