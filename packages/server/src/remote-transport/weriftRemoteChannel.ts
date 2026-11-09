import { chunkFrames, createChannelAssembler } from "@thinkrail/contracts";
import type { RTCDataChannel } from "werift";
import type { RemoteChannel } from "./channel";

/**
 * Adapts a werift `RTCDataChannel` to the transport-agnostic `RemoteChannel` the wire protocol runs over.
 * werift (pure TS) is validated under Bun, so the host side needs no native WebRTC binding. The peer
 * negotiation that produces the channel, and its wiring through the signaling server, are later slices.
 */
export function toRemoteChannel(channel: RTCDataChannel): RemoteChannel {
	let closed = false;
	return {
		get open() {
			return !closed && channel.readyState === "open";
		},
		send(data) {
			for (const frame of chunkFrames(data) ?? [data]) channel.send(Buffer.from(frame));
		},
		onMessage(handler) {
			const assemble = createChannelAssembler();
			channel.onMessage.subscribe((message) => {
				const whole = assemble(
					typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message),
				);
				if (whole) handler(whole);
			});
		},
		onClose(handler) {
			channel.stateChanged.subscribe((state) => {
				if (state === "closed") handler();
			});
		},
		close() {
			closed = true;
			channel.close();
		},
	};
}
