export const SLOW_CONSUMER_DRAIN_DEADLINE_MS = 30_000;

export class SlowConsumerError extends Error {
	readonly code = "WS_SLOW_CONSUMER";

	constructor() {
		super("a socket fell past the outbound buffer limit and was closed");
		this.name = "SlowConsumerError";
	}
}

export type SendOutcome = "delivered" | "backpressured" | "dropped";

export interface OutboundSocket {
	readonly readyState: number;
	readonly data: { slowSince?: number };
	send(frame: string): number;
	getBufferedAmount(): number;
	close(): void;
	terminate(): void;
}

export function sendOrQuarantine(
	ws: OutboundSocket,
	frame: string,
	what: string,
	warn: (message: string, error: SlowConsumerError) => void,
	now: number = performance.now(),
): SendOutcome {
	if (ws.data.slowSince !== undefined) return "dropped";
	let status: number;
	try {
		status = ws.send(frame);
	} catch {
		ws.close();
		return "dropped";
	}
	if (status > 0) return "delivered";
	if (status === -1) return "backpressured";
	if (ws.readyState !== WebSocket.OPEN) {
		ws.close();
		return "dropped";
	}
	ws.data.slowSince = now;
	warn(
		`${what} dropped with ${ws.getBufferedAmount()} bytes buffered; closing the socket once it drains`,
		new SlowConsumerError(),
	);
	return "dropped";
}

export function settleSlowConsumer(
	ws: OutboundSocket,
	now: number = performance.now(),
): "healthy" | "draining" | "closed" {
	const since = ws.data.slowSince;
	if (since === undefined) return "healthy";
	if (ws.getBufferedAmount() === 0) {
		ws.close();
		return "closed";
	}
	if (now - since < SLOW_CONSUMER_DRAIN_DEADLINE_MS) return "draining";
	ws.terminate();
	return "closed";
}
