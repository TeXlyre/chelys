// src/webrtc-polyfill/RTCDataChannel.ts
import { invoke } from '@tauri-apps/api/core';

const MAX_SEND_ATTEMPTS = 3;
const SEND_RETRY_DELAYS_MS = [100, 250] as const;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type PendingSend =
	| { kind: 'string'; data: string; size: number; attempts: number }
	| { kind: 'binary'; data: number[]; size: number; attempts: number };

type ChannelEventHandler<TEvent extends Event = Event> =
	| ((this: TauriRTCDataChannel, event: TEvent) => unknown)
	| null;

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export class TauriRTCDataChannel extends EventTarget {
	readyState: RTCDataChannelState = 'connecting';
	bufferedAmount = 0;
	bufferedAmountLowThreshold = 0;

	private binaryTypeValue: BinaryType = 'arraybuffer';
	private sendQueue: PendingSend[] = [];
	private sending = false;

	onopen: ChannelEventHandler = null;
	onclose: ChannelEventHandler = null;
	onerror: ChannelEventHandler = null;
	onmessage: ChannelEventHandler<MessageEvent> = null;
	onbufferedamountlow: ChannelEventHandler = null;

	constructor(
		public readonly channelId: string,
		public readonly label: string,
		public readonly ordered = true,
		public readonly protocol = '',
	) {
		super();
	}

	get binaryType(): BinaryType {
		return this.binaryTypeValue;
	}

	set binaryType(value: BinaryType) {
		this.binaryTypeValue = value;
	}

	emit(type: string, payload: unknown): void {
		switch (type) {
			case 'open':
				this.open();
				break;
			case 'close':
				this.finishClose();
				break;
			case 'error':
				this.emitError(payload);
				break;
			case 'message':
				this.emitMessage(payload);
				break;
		}
	}

	fail(error: unknown): void {
		if (this.readyState === 'closed') return;
		this.emitError(error);
		this.close();
	}

	send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
		if (this.readyState === 'closing' || this.readyState === 'closed') return;

		if (typeof data === 'string') {
			this.enqueue({
				kind: 'string',
				data,
				size: textEncoder.encode(data).byteLength,
				attempts: 0,
			});
			return;
		}

		if (data instanceof Blob) throw new Error('Blob send not supported');

		const buffer =
			data instanceof ArrayBuffer
				? data
				: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
		const bytes = Array.from(new Uint8Array(buffer));
		this.enqueue({
			kind: 'binary',
			data: bytes,
			size: bytes.length,
			attempts: 0,
		});
	}

	close(): void {
		if (this.readyState === 'closing' || this.readyState === 'closed') return;

		this.readyState = 'closing';
		this.clearQueue();
		void invoke('rtc_channel_close', { channelId: this.channelId }).catch(
			(error) =>
				console.warn(`[rtc-channel] failed to close ${this.channelId}:`, error),
		);
		queueMicrotask(() => this.finishClose());
	}

	private open(): void {
		if (this.readyState === 'closed') return;
		this.readyState = 'open';
		this.emitEvent('open', this.onopen);
		void this.pump();
	}

	private emitMessage(payload: unknown): void {
		if (this.readyState === 'closed') return;

		const message = payload as {
			kind: 'string' | 'binary';
			data: number[] | string;
		};
		const bytes =
			typeof message.data === 'string'
				? textEncoder.encode(message.data)
				: Array.isArray(message.data)
					? Uint8Array.from(message.data)
					: new Uint8Array();
		const data =
			message.kind === 'string'
				? textDecoder.decode(bytes)
				: bytes.buffer.slice(
						bytes.byteOffset,
						bytes.byteOffset + bytes.byteLength,
					);
		const event = new MessageEvent('message', { data });
		this.onmessage?.call(this, event);
		this.dispatchEvent(event);
	}

	private enqueue(item: PendingSend): void {
		this.sendQueue.push(item);
		this.bufferedAmount += item.size;
		if (this.readyState === 'open') void this.pump();
	}

	private async pump(): Promise<void> {
		if (this.sending || this.readyState !== 'open') return;
		this.sending = true;

		try {
			while (this.readyState === 'open') {
				const item = this.sendQueue[0];
				if (!item) return;

				try {
					await this.sendItem(item);
				} catch (error) {
					item.attempts += 1;
					if (item.attempts < MAX_SEND_ATTEMPTS) {
						await delay(SEND_RETRY_DELAYS_MS[item.attempts - 1] ?? 500);
						continue;
					}

					console.error(
						`[rtc-channel] send failed for ${this.channelId} (${item.size} bytes):`,
						error,
					);
					this.fail(error);
					return;
				}

				this.sendQueue.shift();
				this.consumeBufferedAmount(item.size);
			}
		} finally {
			this.sending = false;
			if (this.readyState === 'open' && this.sendQueue.length > 0) {
				void this.pump();
			}
		}
	}

	private sendItem(item: PendingSend): Promise<unknown> {
		const command =
			item.kind === 'string'
				? 'rtc_channel_send_string'
				: 'rtc_channel_send_binary';
		return invoke(command, {
			channelId: this.channelId,
			data: item.data,
		});
	}

	private consumeBufferedAmount(size: number): void {
		const previous = this.bufferedAmount;
		this.bufferedAmount = Math.max(0, previous - size);
		if (
			previous > this.bufferedAmountLowThreshold &&
			this.bufferedAmount <= this.bufferedAmountLowThreshold
		) {
			this.emitEvent('bufferedamountlow', this.onbufferedamountlow);
		}
	}

	private clearQueue(): void {
		this.sendQueue.length = 0;
		this.bufferedAmount = 0;
	}

	private emitError(error: unknown): void {
		const event = new Event('error') as Event & { error?: unknown };
		event.error = error;
		this.onerror?.call(this, event);
		this.dispatchEvent(event);
	}

	private emitEvent(type: string, handler: ChannelEventHandler): void {
		const event = new Event(type);
		handler?.call(this, event);
		this.dispatchEvent(event);
	}

	private finishClose(): void {
		if (this.readyState === 'closed') return;
		this.readyState = 'closed';
		this.clearQueue();
		this.emitEvent('close', this.onclose);
	}
}
