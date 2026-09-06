import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    installWebRtcPolyfill,
    uninstallWebRtcPolyfill,
} from '@src/webrtc-polyfill';
import { TauriRTCDataChannel } from '@src/webrtc-polyfill/RTCDataChannel';
import {
    dispatchChannelEvent,
    registerChannel,
} from '@src/webrtc-polyfill/RTCPeerConnection';
import { Channel, callsFor, resetTauriCore } from '@tests/mocks/tauri-core';
import { resetTauriEvent } from '@tests/mocks/tauri-event';
import { nativeEncodeFrame } from '@tests/mocks/nativeFrame';

const bytes = (length: number, seed = 0): Uint8Array =>
    Uint8Array.from({ length }, (_, index) => (index * 31 + seed) % 256);

let nextId = 0;
const channelId = (): string => `11111111-2222-3333-4444-${nextId++}`;

const deliver = (frame: Uint8Array): void => {
    const [call] = callsFor('rtc_set_message_sink');
    const { sink } = call.payload as { sink: Channel<ArrayBuffer> };
    sink.onmessage(frame.buffer as ArrayBuffer);
};

const openChannel = (id: string): TauriRTCDataChannel => {
    const channel = new TauriRTCDataChannel(id, 'data');
    registerChannel(id, channel);
    channel.emit('open', null);
    return channel;
};

describe('WebRTC Message Sink', () => {
    beforeEach(async () => {
        resetTauriCore();
        resetTauriEvent();
        await installWebRtcPolyfill();
    });

    afterEach(() => {
        uninstallWebRtcPolyfill();
    });

    it('should register exactly one sink for the whole polyfill', () => {
        expect(callsFor('rtc_set_message_sink')).toHaveLength(1);
    });

    it('should route a native frame to the matching channel', () => {
        const id = channelId();
        const channel = openChannel(id);
        const payload = bytes(2048, 5);
        const received: ArrayBuffer[] = [];
        channel.onmessage = (event) => received.push(event.data);

        deliver(nativeEncodeFrame(id, false, payload));

        expect(received).toHaveLength(1);
        expect(Array.from(new Uint8Array(received[0]))).toEqual(
            Array.from(payload),
        );
    });

    it('should demultiplex frames addressed to different channels', () => {
        const first = openChannel(channelId());
        const second = openChannel(channelId());
        const firstSeen: number[] = [];
        const secondSeen: number[] = [];
        first.onmessage = (event) =>
            firstSeen.push(new Uint8Array(event.data)[0]);
        second.onmessage = (event) =>
            secondSeen.push(new Uint8Array(event.data)[0]);

        deliver(nativeEncodeFrame(second.channelId, false, Uint8Array.of(2)));
        deliver(nativeEncodeFrame(first.channelId, false, Uint8Array.of(1)));

        expect(firstSeen).toEqual([1]);
        expect(secondSeen).toEqual([2]);
    });

    it('should replay frames that arrive before the channel is registered', () => {
        const id = channelId();
        deliver(nativeEncodeFrame(id, false, Uint8Array.of(1)));
        deliver(nativeEncodeFrame(id, false, Uint8Array.of(2)));

        const channel = new TauriRTCDataChannel(id, 'data');
        const received: number[] = [];
        channel.onmessage = (event) =>
            received.push(new Uint8Array(event.data)[0]);
        dispatchChannelEvent(id, 'open', null);
        registerChannel(id, channel);

        expect(received).toEqual([1, 2]);
    });

    it('should drop a malformed frame without disturbing the next one', () => {
        const id = channelId();
        const channel = openChannel(id);
        const received: number[] = [];
        channel.onmessage = (event) =>
            received.push(new Uint8Array(event.data)[0]);

        expect(() => deliver(Uint8Array.of(1))).not.toThrow();
        deliver(nativeEncodeFrame(id, false, Uint8Array.of(7)));

        expect(received).toEqual([7]);
    });

    it('should deliver an empty payload as a zero-length buffer', () => {
        const id = channelId();
        const channel = openChannel(id);
        const received: ArrayBuffer[] = [];
        channel.onmessage = (event) => received.push(event.data);

        deliver(nativeEncodeFrame(id, false, new Uint8Array(0)));

        expect(received[0].byteLength).toBe(0);
    });
});
