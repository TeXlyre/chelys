import { describe, expect, it } from 'vitest';
import {
    decodeMessageFrame,
    encodeMessageFrame,
} from '@src/webrtc-polyfill/messageFrame';
import { nativeDecodeFrame, nativeEncodeFrame } from '@tests/mocks/nativeFrame';

const CHANNEL_ID = '0f3d8a1e-6c22-4f9b-9a77-1b2c3d4e5f60';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const bytes = (length: number, seed = 0): Uint8Array =>
    Uint8Array.from({ length }, (_, index) => (index * 31 + seed) % 256);

describe('Message Frame', () => {
    describe('encodeMessageFrame', () => {
        it('should lay out the header the native side expects', () => {
            const frame = encodeMessageFrame(CHANNEL_ID, bytes(4));

            expect(frame[0]).toBe(1);
            expect(frame[1]).toBe(CHANNEL_ID.length);
            expect(frame.byteLength).toBe(2 + CHANNEL_ID.length + 4);
        });

        it('should produce a payload the native decoder recovers byte for byte', () => {
            const payload = bytes(64 * 1024, 7);
            const decoded = nativeDecodeFrame(
                encodeMessageFrame(CHANNEL_ID, payload),
            );

            expect(decoded.isString).toBe(false);
            expect(decoded.channelId).toBe(CHANNEL_ID);
            expect(Array.from(decoded.payload)).toEqual(Array.from(payload));
        });

        it('should size the header by utf-8 bytes, not code points', () => {
            const decoded = nativeDecodeFrame(
                encodeMessageFrame(CHANNEL_ID, 'héllo 🌍'),
            );

            expect(decoded.isString).toBe(true);
            expect(textDecoder.decode(decoded.payload)).toBe('héllo 🌍');
        });

        it('should encode an empty payload as a header-only frame', () => {
            const frame = encodeMessageFrame(CHANNEL_ID, new Uint8Array(0));

            expect(frame.byteLength).toBe(2 + CHANNEL_ID.length);
            expect(nativeDecodeFrame(frame).payload).toHaveLength(0);
        });

        it('should reject a channel id that does not fit the length header', () => {
            expect(() => encodeMessageFrame('a'.repeat(256), 'x')).toThrow();
        });
    });

    describe('decodeMessageFrame', () => {
        it('should recover binary payloads produced by the native side', () => {
            const payload = bytes(1024, 3);
            const frame = nativeEncodeFrame(CHANNEL_ID, false, payload);
            const decoded = decodeMessageFrame(frame.buffer as ArrayBuffer);

            expect(decoded?.channelId).toBe(CHANNEL_ID);
            expect(decoded?.kind).toBe('binary');
            expect(Array.from(new Uint8Array(decoded?.data as ArrayBuffer))).toEqual(
                Array.from(payload),
            );
        });

        it('should return a buffer sized to the payload rather than the frame', () => {
            const frame = nativeEncodeFrame(CHANNEL_ID, false, bytes(10));
            const decoded = decodeMessageFrame(frame.buffer as ArrayBuffer);

            expect((decoded?.data as ArrayBuffer).byteLength).toBe(10);
        });

        it('should detach the payload from the incoming frame buffer', () => {
            const frame = nativeEncodeFrame(CHANNEL_ID, false, bytes(8));
            const decoded = decodeMessageFrame(frame.buffer as ArrayBuffer);
            frame.fill(0xff);

            expect(new Uint8Array(decoded?.data as ArrayBuffer)[0]).toBe(0);
        });

        it('should decode multi-byte string payloads', () => {
            const frame = nativeEncodeFrame(
                CHANNEL_ID,
                true,
                textEncoder.encode('héllo 🌍'),
            );

            expect(decodeMessageFrame(frame.buffer as ArrayBuffer)).toEqual({
                channelId: CHANNEL_ID,
                kind: 'string',
                data: 'héllo 🌍',
            });
        });

        it('should reject frames shorter than the header', () => {
            expect(decodeMessageFrame(new Uint8Array([1]).buffer)).toBeNull();
        });

        it('should reject a zero-length channel id', () => {
            expect(decodeMessageFrame(new Uint8Array([1, 0, 9]).buffer)).toBeNull();
        });

        it('should reject a channel id length past the end of the frame', () => {
            expect(decodeMessageFrame(new Uint8Array([1, 8, 9]).buffer)).toBeNull();
        });

        it('should reject an unknown kind byte', () => {
            const frame = nativeEncodeFrame(CHANNEL_ID, false, bytes(4));
            frame[0] = 2;

            expect(decodeMessageFrame(frame.buffer as ArrayBuffer)).toBeNull();
        });
    });
});
