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
	send(frame: string): number;
	getBufferedAmount(): number;
	close(): void;
}

export function sendOrClose(
	ws: OutboundSocket,
	frame: string,
	what: string,
	warn: (message: string, error: SlowConsumerError) => void,
): SendOutcome {
	let status: number;
	try {
		status = ws.send(frame);
	} catch {
		ws.close();
		return "dropped";
	}
	if (status > 0) return "delivered";
	if (status === -1) return "backpressured";
	if (ws.readyState === WebSocket.OPEN) {
		warn(
			`${what} dropped with ${ws.getBufferedAmount()} bytes buffered; closing the socket`,
			new SlowConsumerError(),
		);
	}
	ws.close();
	return "dropped";
}
