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

/** Adapts a native `RTCDataChannel` to a string `DeviceChannel`, decoding binary frames the host may send. */
export function toDeviceChannel(channel: RTCDataChannel): DeviceChannel {
	return {
		get open() {
			return channel.readyState === "open";
		},
		send: (data) => channel.send(data),
		onMessage: (handler) => {
			channel.addEventListener("message", (event: MessageEvent) => {
				const data: unknown = event.data;
				if (typeof data === "string") handler(data);
				else if (data instanceof ArrayBuffer) handler(new TextDecoder().decode(data));
				else if (data instanceof Blob) void data.text().then(handler);
			});
		},
		onClose: (handler) => channel.addEventListener("close", () => handler()),
		close: () => channel.close(),
	};
}
