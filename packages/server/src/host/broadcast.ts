import { terminalDeliveryForSendStatus } from "./terminalSend";

export interface BroadcastTarget {
	send(frame: string): number;
	close(): void;
	/** Present on real sockets; a target that is not subscribed is skipped. */
	isSubscribed?(channel: string): boolean;
}

/**
 * Deliver a channel frame to every subscribed socket, per socket, and close a
 * consumer that could not take it. Frames are fire-and-forget: the replay
 * namespace replays requests, never events, so a frame dropped to backpressure
 * would silently desynchronize that client — a missed `agent_settled` keeps a
 * tab "streaming" forever (#1179). Closing is the recovery: the reconnect
 * welcome resyncs sessions and the transcript. `server.publish` cannot offer
 * this — it reports the subscriber count, not per-subscriber drops.
 */
export function broadcastFrame(
	targets: Iterable<BroadcastTarget>,
	channel: string,
	data: unknown,
): void {
	const frame = JSON.stringify({ channel, data });
	for (const target of targets) {
		if (target.isSubscribed?.(channel) === false) continue;
		if (terminalDeliveryForSendStatus(target.send(frame)) !== "delivered") target.close();
	}
}
