/** Dedicated control rendezvous and encrypted RPC envelopes. */
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const INVITATION_PREFIX = 'chelys-webrtc:';
export const DEDICATED_LABEL = 'chelys-control:dedicated-v1';
export const CONTROL_HELLO = 'chelys-control-v1:hello';
export const MAX_REQUEST = 65_536;
export const MAX_RESPONSE = 512_000;

const hex = (bytes: Uint8Array) =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const digest = async (value: string) =>
	hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const base64 = (bytes: Uint8Array) => {
	let text = '';
	for (let i = 0; i < bytes.length; i += 8192)
		text += String.fromCharCode(...bytes.subarray(i, i + 8192));
	return btoa(text);
};
const unbase64 = (text: string) =>
	Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
const validHash = (value: unknown): value is string =>
	typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const validApiKey = (value: unknown): value is string =>
	typeof value === 'string' && /^chlys_[a-f0-9]{64}$/.test(value);

// Domain separation keeps both the API key and its verification hash out of
// signaling. The room name is not an authorization credential.
export async function dedicatedRoom(hash: string): Promise<string> {
	if (!validHash(hash)) throw new Error('Invalid API key verifier');
	return `chelys-control-v1-${await digest('chelys-control-room-v1:' + hash)}`;
}

export interface ControlInvitation {
	room: string;
	signaling: string[];
}
function validateSignaling(signaling: unknown): string[] {
	if (!Array.isArray(signaling) || !signaling.length || signaling.length > 16)
		throw new Error('Configure at least one signaling server (maximum 16)');
	return [...new Set(signaling.map((value) => {
		if (typeof value !== 'string' || value.length > 2048)
			throw new Error('Invalid signaling server');
		const url = new URL(value);
		const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
		if (url.username || url.password || url.hash ||
			(url.protocol !== 'wss:' && !(url.protocol === 'ws:' && local)))
			throw new Error('Signaling requires wss:// or a local ws:// endpoint');
		return value;
	}))];
}
export async function makeInvitation(hash: string, signaling: string[]): Promise<string> {
	const data: ControlInvitation = {
		room: await dedicatedRoom(hash),
		signaling: validateSignaling(signaling),
	};
	return INVITATION_PREFIX + base64(encoder.encode(JSON.stringify(data)));
}
export function parseInvitation(value: string): ControlInvitation {
	if (!value.startsWith(INVITATION_PREFIX) || value.length > 65_536)
		throw new Error('Invalid Chelys WebRTC invitation');
	try {
		const data = JSON.parse(decoder.decode(unbase64(value.slice(INVITATION_PREFIX.length))));
		if (typeof data.room !== 'string' || !/^chelys-control-v1-[a-f0-9]{64}$/.test(data.room))
			throw new Error('Invalid room');
		return { room: data.room, signaling: validateSignaling(data.signaling) };
	} catch {
		throw new Error('Invalid Chelys WebRTC invitation');
	}
}

// The existing high-entropy key verifier is already available to the host.
// A separately domain-separated key protects RPCs even if an untrusted peer
// joins or impersonates a host in the rendezvous room.
export async function controlKey(hash: string): Promise<CryptoKey> {
	if (!validHash(hash)) throw new Error('Invalid API key verifier');
	const material = await crypto.subtle.digest(
		'SHA-256', encoder.encode('chelys-control-encryption-v1:' + hash),
	);
	return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export const newChallenge = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const validChallenge = validHash;
type Direction = 'request' | 'response';
function aad(challenge: string, direction: Direction) {
	if (!validChallenge(challenge)) throw new Error('Invalid control challenge');
	return encoder.encode(`chelys-control-v1:${direction}:${challenge}`);
}
export async function seal(
	key: CryptoKey, challenge: string, direction: Direction, text: string,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const cipher = new Uint8Array(await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: aad(challenge, direction) },
		key, encoder.encode(text),
	));
	return JSON.stringify({ iv: base64(iv), data: base64(cipher) });
}
export async function unseal(
	key: CryptoKey, challenge: string, direction: Direction, envelope: string,
): Promise<string> {
	const max = direction === 'request' ? MAX_REQUEST : MAX_RESPONSE;
	if (envelope.length > max * 6 + 1024) throw new Error('Control message too large');
	const value = JSON.parse(envelope);
	if (typeof value.iv !== 'string' || typeof value.data !== 'string')
		throw new Error('Invalid encrypted control message');
	const iv = unbase64(value.iv);
	if (iv.length !== 12) throw new Error('Invalid control nonce');
	const text = decoder.decode(await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv, additionalData: aad(challenge, direction) },
		key, unbase64(value.data),
	));
	if (text.length > max) throw new Error('Control message too large');
	return text;
}
