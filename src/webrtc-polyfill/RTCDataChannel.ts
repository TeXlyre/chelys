// src/webrtc-polyfill/RTCDataChannel.ts
import { invoke } from "@tauri-apps/api/core";

export class TauriRTCDataChannel extends EventTarget {
    readyState: "connecting" | "open" | "closing" | "closed" = "connecting";
    bufferedAmount = 0;

    private _binaryType: "blob" | "arraybuffer" = "arraybuffer";

    get binaryType(): "blob" | "arraybuffer" {
        return this._binaryType;
    }
    set binaryType(value: "blob" | "arraybuffer") {
        console.log("[ch.binaryType]", this.channelId, value);
        this._binaryType = value;
    }

    onopen: ((this: TauriRTCDataChannel, ev: Event) => any) | null = null;
    onclose: ((this: TauriRTCDataChannel, ev: Event) => any) | null = null;
    onerror: ((this: TauriRTCDataChannel, ev: Event) => any) | null = null;
    onmessage: ((this: TauriRTCDataChannel, ev: MessageEvent) => any) | null = null;

    constructor(
        public readonly channelId: string,
        public readonly label: string,
        public readonly ordered = true,
        public readonly protocol = "",
    ) {
        super();
    }


    emit(type: string, payload: unknown): void {
        console.log("[ch]", this.channelId, type, this.readyState);
        if (type === "open") {
            this.readyState = "open";
            const pending = this.pendingSends;
            this.pendingSends = [];
            for (const p of pending) {
                if (p.kind === "string") {
                    void invoke("rtc_channel_send_string", { channelId: this.channelId, data: p.data });
                } else {
                    void invoke("rtc_channel_send_binary", { channelId: this.channelId, data: p.data });
                }
            }
            const ev = new Event("open");
            this.onopen?.(ev);
            this.dispatchEvent(ev);
        } else if (type === "close") {
            this.readyState = "closed";
            const ev = new Event("close");
            this.onclose?.(ev);
            this.dispatchEvent(ev);
        } else if (type === "error") {
            const ev = new Event("error");
            (ev as any).error = payload;
            this.onerror?.(ev);
            this.dispatchEvent(ev);
        } else if (type === "message") {
            const p = payload as { kind: "string" | "binary"; data: number[] | string };
            let bytes: Uint8Array;
            if (typeof p.data === "string") {
                bytes = new TextEncoder().encode(p.data);
            } else if (Array.isArray(p.data)) {
                bytes = Uint8Array.from(p.data);
            } else {
                bytes = new Uint8Array(0);
            }
            console.log("[ch.msg]", this.channelId, p.kind, bytes.length);
            const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            const data: string | ArrayBuffer =
                p.kind === "string" ? new TextDecoder().decode(bytes) : buffer;
            const ev = new MessageEvent("message", { data });
            this.onmessage?.(ev);
            this.dispatchEvent(ev);
        }
    }

    private pendingSends: Array<{ kind: "string"; data: string } | { kind: "binary"; data: number[] }> = [];

    send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
        if (this.readyState === "closing" || this.readyState === "closed") {
            return;
        }
        if (typeof data === "string") {
            if (this.readyState !== "open") {
                this.pendingSends.push({ kind: "string", data });
                return;
            }
            void invoke("rtc_channel_send_string", { channelId: this.channelId, data }).catch(
                (err) => console.warn("[ch.send] string failed:", this.channelId, err),
            );
            return;
        }
        let buf: ArrayBuffer;
        if (data instanceof ArrayBuffer) buf = data;
        else if (ArrayBuffer.isView(data))
            buf = data.buffer.slice(
                data.byteOffset,
                data.byteOffset + data.byteLength,
            ) as ArrayBuffer;
        else throw new Error("Blob send not supported");
        const arr = Array.from(new Uint8Array(buf));
        if (this.readyState !== "open") {
            this.pendingSends.push({ kind: "binary", data: arr });
            return;
        }
        void invoke("rtc_channel_send_binary", { channelId: this.channelId, data: arr }).catch(
            (err) => console.warn("[ch.send] binary failed:", this.channelId, err),
        );
    }

    close(): void {
        this.readyState = "closing";
        void invoke("rtc_channel_close", { channelId: this.channelId });
    }
}