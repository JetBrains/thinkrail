import type { TerminalDeliveryResult } from "../terminal";

export function terminalDeliveryForSendStatus(status: number): TerminalDeliveryResult {
	if (status > 0) return "delivered";
	if (status === -1) return "backpressured";
	return "unavailable";
}
