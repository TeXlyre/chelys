import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TauriRTCDataChannel } from '@src/webrtc-polyfill/RTCDataChannel';
import {
    callsFor,
    resetTauriCore,
    setInvokeHandler,
} from '@tests/mocks/tauri-core';
import { nativeDecodeFrame } from '@tests/mocks/nativeFrame';

const CHANNEL_ID = '0f3d8a1e-6c22-4f9b-9a77-1b2c3d4e5f60';

const textDecoder = new TextDecoder();

const bytes = (length: number, seed = 0): Uint8Array =>
    Uint8Array.from({ length }, (_, index) => (index * 31 + seed) % 256);

const openChannel = (): TauriRTCDataChannel => {
    const channel = new TauriRTCDataChannel(CHANNEL_ID, 'data');
    channel.emit('open', null);
    return channel;
};

const sentFrames = () =>
    callsFor('rtc_channel_send').map((call) =>
        nativeDecodeFrame(call.payload as Uint8Array),
    );

const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe('Tauri RTC Data Channel', () => {
    beforeEach(() => {
        resetTauriCore();
    });

    describe('send', () => {
        it('should transmit only the bytes covered by a view', async () => {
            const backing = bytes(64);
            const channel = openChannel();

            channel.send(new Uint8Array(backing.buffer, 16, 8));
            await flush();

            const [frame] = sentFrames();
            expect(frame.channelId).toBe(CHANNEL_ID);
            expect(Array.from(frame.payload)).toEqual(
                Array.from(backing.subarray(16, 24)),
            );
        });

        it('should snapshot a queued payload while an earlier send is in flight', async () => {
            const gate: Array<() => void> = [];
            setInvokeHandler(
                'rtc_channel_send',
                () => new Promise<void>((resolve) => gate.push(resolve)),
            );
            const scratch = bytes(8);
            const channel = openChannel();

            channel.send(bytes(4));
            await flush();
            channel.send(scratch);
            scratch.fill(0xff);
            gate[0]();
            await flush();
            gate[1]();
            await flush();

            expect(Array.from(sentFrames()[1].payload)).toEqual(
                Array.from(bytes(8)),
            );
        });

        it('should mark string payloads for the native text path', async () => {
            const channel = openChannel();

            channel.send('héllo 🌍');
            await flush();

            const [frame] = sentFrames();
            expect(frame.isString).toBe(true);
            expect(textDecoder.decode(frame.payload)).toBe('héllo 🌍');
        });

        it('should hold sends until the channel opens and keep their order', async () => {
            const channel = new TauriRTCDataChannel(CHANNEL_ID, 'data');

            channel.send(Uint8Array.of(1));
            channel.send(Uint8Array.of(2));
            await flush();
            expect(sentFrames()).toHaveLength(0);

            channel.emit('open', null);
            await flush();

            expect(sentFrames().map((frame) => frame.payload[0])).toEqual([1, 2]);
        });

        it('should not let a later send overtake a slow one', async () => {
            const gate: Array<() => void> = [];
            setInvokeHandler(
                'rtc_channel_send',
                () => new Promise<void>((resolve) => gate.push(resolve)),
            );
            const channel = openChannel();

            channel.send(Uint8Array.of(1));
            channel.send(Uint8Array.of(2));
            await flush();

            expect(callsFor('rtc_channel_send')).toHaveLength(1);
            gate[0]();
            await flush();
            expect(sentFrames().map((frame) => frame.payload[0])).toEqual([1, 2]);
        });

        it('should ignore sends once the channel is closing', async () => {
            const channel = openChannel();

            channel.close();
            channel.send(Uint8Array.of(1));
            await flush();

            expect(callsFor('rtc_channel_send')).toHaveLength(0);
        });
    });

    describe('bufferedAmount', () => {
        it('should track payload bytes and drain to zero', async () => {
            const channel = openChannel();
            const lowEvents: Event[] = [];
            channel.addEventListener('bufferedamountlow', (event) =>
                lowEvents.push(event),
            );

            channel.send(bytes(100));
            expect(channel.bufferedAmount).toBe(100);

            await flush();
            expect(channel.bufferedAmount).toBe(0);
            expect(lowEvents).toHaveLength(1);
        });
    });

    describe('retries', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should retry a failed send without duplicating the payload', async () => {
            let attempts = 0;
            setInvokeHandler('rtc_channel_send', () => {
                attempts += 1;
                if (attempts < 3) throw new Error('native send failed');
                return undefined;
            });
            const channel = openChannel();

            channel.send(bytes(4));
            await vi.advanceTimersByTimeAsync(1000);

            expect(attempts).toBe(3);
            expect(channel.readyState).toBe('open');
            expect(channel.bufferedAmount).toBe(0);
        });

        it('should fail the channel once the attempt budget is exhausted', async () => {
            setInvokeHandler('rtc_channel_send', () => {
                throw new Error('native send failed');
            });
            const errors: Event[] = [];
            const closes: Event[] = [];
            const channel = openChannel();
            channel.addEventListener('error', (event) => errors.push(event));
            channel.addEventListener('close', (event) => closes.push(event));

            channel.send(bytes(4));
            await vi.advanceTimersByTimeAsync(1000);

            expect(errors).toHaveLength(1);
            expect(closes).toHaveLength(1);
            expect(channel.readyState).toBe('closed');
            expect(channel.bufferedAmount).toBe(0);
        });
    });

    describe('incoming messages', () => {
        it('should deliver the decoded payload untouched', () => {
            const channel = openChannel();
            const payload = bytes(16).buffer;
            const received: unknown[] = [];
            channel.onmessage = (event) => received.push(event.data);

            channel.emit('message', { kind: 'binary', data: payload });

            expect(received).toEqual([payload]);
        });

        it('should drop messages that arrive after close', () => {
            const channel = openChannel();
            const received: unknown[] = [];
            channel.onmessage = (event) => received.push(event.data);

            channel.emit('close', null);
            channel.emit('message', { kind: 'string', data: 'late' });

            expect(received).toHaveLength(0);
        });
    });
});
