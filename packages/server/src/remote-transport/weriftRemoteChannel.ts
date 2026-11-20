import {
	chunkFrames,
	createChannelAssembler,
	WS_MAX_FRAME_BYTES,
	WS_OUTBOUND_BUFFER_LIMIT_BYTES,
} from "@thinkrail/contracts";
import { logger } from "../log";
import type { RemoteChannel } from "./channel";
import type { RTCDataChannel } from "./werift";

const log = logger("remote-transport");

export class RemoteChannelSlowConsumerError extends Error {
	readonly code = "REMOTE_CHANNEL_SLOW_CONSUMER";

	constructor() {
		super("a device channel fell past the outbound buffer limit and was closed");
		this.name = "RemoteChannelSlowConsumerError";
	}
}

export interface RemoteChannelLimits {
	/** The largest message the device may send, reassembled. */
	maxMessageBytes?: number;
	/** Past this many bytes queued toward the device, a send closes the channel instead. */
	maxBufferedBytes?: number;
}

/** Adapts a werift `RTCDataChannel` to the transport-agnostic `RemoteChannel` the wire protocol runs over. */
export function toRemoteChannel(
	channel: RTCDataChannel,
	{
		maxMessageBytes = WS_MAX_FRAME_BYTES,
		maxBufferedBytes = WS_OUTBOUND_BUFFER_LIMIT_BYTES,
	}: RemoteChannelLimits = {},
): RemoteChannel {
	let closed = false;
	const close = (): void => {
		closed = true;
		channel.close();
	};
	return {
		get open() {
			return !closed && channel.readyState === "open";
		},
		send(data) {
			if (closed) return;
			if (channel.bufferedAmount > maxBufferedBytes) {
				log.warn(
					`device channel closed with ${channel.bufferedAmount} bytes buffered`,
					new RemoteChannelSlowConsumerError(),
				);
				close();
				return;
			}
			for (const frame of chunkFrames(data) ?? [data])
				channel.send(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
		},
		onMessage(handler) {
			const assemble = createChannelAssembler(maxMessageBytes);
			channel.onMessage.subscribe((message) => {
				if (closed) return;
				let whole: Uint8Array | null;
				try {
					whole = assemble(
						typeof message === "string"
							? new TextEncoder().encode(message)
							: new Uint8Array(message),
					);
				} catch (error) {
					log.warn("device channel closed on an oversized message", error);
					close();
					return;
				}
				if (whole) handler(whole);
			});
		},
		onClose(handler) {
			channel.stateChanged.subscribe((state) => {
				if (state === "closed") handler();
			});
		},
		close,
	};
}
