// src/webrtc-polyfill/index.ts
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
	TauriRTCPeerConnection,
	dispatchPeerEvent,
	dispatchChannelEvent,
	getConnectedPeerCount,
	resetPeerScope,
	subscribePeerScope,
} from './RTCPeerConnection';
import { TauriRTCDataChannel } from './RTCDataChannel';

let installPromise: Promise<void> | null = null;
let unlistenPeer: UnlistenFn | null = null;
let unlistenChannel: UnlistenFn | null = null;

export function installWebRtcPolyfill(): Promise<void> {
	if (installPromise) return installPromise;

	installPromise = (async () => {
		(globalThis as any).RTCPeerConnection = TauriRTCPeerConnection;
		(globalThis as any).RTCDataChannel = TauriRTCDataChannel;
		(globalThis as any).__CHELYS_WEBRTC_SCOPE_CONTROL__ = {
			reset: resetPeerScope,
			subscribe: subscribePeerScope,
			getConnectedCount: getConnectedPeerCount,
		};

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
				this.candidate = init.candidate ?? '';
				this.sdpMid = init.sdpMid ?? null;
				this.sdpMLineIndex = init.sdpMLineIndex ?? null;
				this.usernameFragment = init.usernameFragment ?? null;
			}
		};

		unlistenPeer = await listen<{
			peer_id: string;
			type: string;
			payload: unknown;
		}>(
			'rtc-peer',
			(event: {
				payload: {
					peer_id: string;
					type: string;
					payload: unknown;
				};
			}) => {
				dispatchPeerEvent(
					event.payload.peer_id,
					event.payload.type,
					event.payload.payload,
				);
			},
		);

		unlistenChannel = await listen<{
			channel_id: string;
			type: string;
			payload: unknown;
		}>(
			'rtc-channel',
			(event: {
				payload: {
					channel_id: string;
					type: string;
					payload: unknown;
				};
			}) => {
				dispatchChannelEvent(
					event.payload.channel_id,
					event.payload.type,
					event.payload.payload,
				);
			},
		);
	})();

	return installPromise;
}

export function uninstallWebRtcPolyfill(): void {
	unlistenPeer?.();
	unlistenChannel?.();
	unlistenPeer = null;
	unlistenChannel = null;
	installPromise = null;
	delete (globalThis as any).__CHELYS_WEBRTC_SCOPE_CONTROL__;
}
