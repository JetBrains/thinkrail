import type { TerminalDeliveryResult } from "../terminal";

export const BACKPRESSURE_RECONCILE_MS = 1_000;

export function terminalDeliveryForSendStatus(status: number): TerminalDeliveryResult {
	if (status > 0) return "delivered";
	if (status === -1) return "backpressured";
	return "unavailable";
}

export function drainedClientKeys(
	latched: Iterable<string>,
	bufferedAmount: (clientKey: string) => number | undefined,
): string[] {
	return [...latched].filter((clientKey) => bufferedAmount(clientKey) === 0);
}
