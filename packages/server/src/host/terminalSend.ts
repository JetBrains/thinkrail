import type { TerminalDeliveryResult } from "../terminal";

/** Map Bun's documented ServerWebSocket.send status to the terminal delivery contract. */
export function terminalDeliveryForSendStatus(status: number): TerminalDeliveryResult {
	if (status > 0) return "delivered";
	if (status === -1) return "backpressured"; // frame was enqueued; stop sending until drain
	return "unavailable"; // 0: frame was dropped and must be retried
}
