const HEADER_BYTES = 2;
const KIND_STRING = 0;
const KIND_BINARY = 1;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface NativeFrame {
    isString: boolean;
    channelId: string;
    payload: Uint8Array;
}

export function nativeEncodeFrame(
    channelId: string,
    isString: boolean,
    payload: Uint8Array,
): Uint8Array {
    const id = textEncoder.encode(channelId);
    const frame = new Uint8Array(HEADER_BYTES + id.length + payload.length);
    frame[0] = isString ? KIND_STRING : KIND_BINARY;
    frame[1] = id.length;
    frame.set(id, HEADER_BYTES);
    frame.set(payload, HEADER_BYTES + id.length);
    return frame;
}

export function nativeDecodeFrame(frame: Uint8Array): NativeFrame {
    if (frame.length < HEADER_BYTES) {
        throw new Error('message frame is truncated');
    }

    const kind = frame[0];
    const idLength = frame[1];
    if (
        kind > KIND_BINARY ||
        idLength === 0 ||
        frame.length < HEADER_BYTES + idLength
    ) {
        throw new Error('message frame header is malformed');
    }

    const body = HEADER_BYTES + idLength;
    return {
        isString: kind === KIND_STRING,
        channelId: textDecoder.decode(frame.subarray(HEADER_BYTES, body)),
        payload: frame.subarray(body),
    };
}
