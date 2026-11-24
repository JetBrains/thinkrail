import { chunkFrames, createChannelAssembler } from "@thinkrail/contracts";

/**
 * The device (browser) side of the remote data path. The wire client runs over this string channel; the
 * adapter below wraps a native `RTCDataChannel` (the browser needs no WebRTC library — it is built in).
 */
export interface DeviceChannel {
	send(data: string): void;
	onMessage(handler: (data: string) => void): void;
	onClose(handler: () => void): void;
	close(): void;
	readonly open: boolean;
}

/**
 * Adapts a native `RTCDataChannel` to a string `DeviceChannel`. Both directions use contracts' channel framing,
 * so a message larger than the platform's per-message cap travels as chunks. Binary frames arrive as
 * `ArrayBuffer` (never `Blob`, whose async read could reorder chunks).
 */
export function toDeviceChannel(channel: RTCDataChannel): DeviceChannel {
	channel.binaryType = "arraybuffer";
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	return {
		get open() {
			return channel.readyState === "open";
		},
		send: (data) => {
			const chunks = chunkFrames(encoder.encode(data));
			if (!chunks) channel.send(data);
			else for (const chunk of chunks) channel.send(chunk);
		},
		onMessage: (handler) => {
			const assemble = createChannelAssembler();
			channel.addEventListener("message", (event: MessageEvent) => {
				const data: unknown = event.data;
				if (typeof data === "string") handler(data);
				else if (data instanceof ArrayBuffer) {
					const whole = assemble(new Uint8Array(data));
					if (whole) handler(decoder.decode(whole));
				}
			});
		},
		onClose: (handler) => channel.addEventListener("close", () => handler()),
		close: () => channel.close(),
	};
}
