// src/webrtc-polyfill/messageFrame.ts
const HEADER_BYTES = 2;
const KIND_STRING = 0;
const KIND_BINARY = 1;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface MessageFrame {
	channelId: string;
	kind: 'string' | 'binary';
	data: string | ArrayBuffer;
}

export function encodeMessageFrame(
	channelId: string,
	data: string | Uint8Array,
): Uint8Array {
	const id = textEncoder.encode(channelId);
	if (id.byteLength === 0 || id.byteLength > 255) {
		throw new Error(`unsupported channel id: ${channelId}`);
	}

	const isString = typeof data === 'string';
	const body = isString ? textEncoder.encode(data) : data;
	const frame = new Uint8Array(HEADER_BYTES + id.byteLength + body.byteLength);
	frame[0] = isString ? KIND_STRING : KIND_BINARY;
	frame[1] = id.byteLength;
	frame.set(id, HEADER_BYTES);
	frame.set(body, HEADER_BYTES + id.byteLength);
	return frame;
}

export function decodeMessageFrame(frame: ArrayBuffer): MessageFrame | null {
	const view = new Uint8Array(frame);
	if (view.byteLength < HEADER_BYTES) return null;

	const kind = view[0];
	const idLength = view[1];
	if (kind !== KIND_STRING && kind !== KIND_BINARY) return null;
	if (idLength === 0 || view.byteLength < HEADER_BYTES + idLength) return null;

	const channelId = textDecoder.decode(
		view.subarray(HEADER_BYTES, HEADER_BYTES + idLength),
	);
	const body = view.subarray(HEADER_BYTES + idLength);

	return kind === KIND_STRING
		? { channelId, kind: 'string', data: textDecoder.decode(body) }
		: { channelId, kind: 'binary', data: body.slice().buffer };
}
