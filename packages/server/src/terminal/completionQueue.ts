import type { TerminalDataPush, TerminalExitPush } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import type { TerminalDeliveryResult } from "./outputBatcher";

export interface TerminalCompletion {
	data?: TerminalDataPush;
	exit: TerminalExitPush;
}

type PushToClient = (clientKey: string, channel: string, data: unknown) => TerminalDeliveryResult;

export interface TerminalCompletionQueue {
	/** Add one terminal's natural completion and try to deliver it now. */
	enqueue(clientKey: string, completion: TerminalCompletion): void;
	/** Resume this client's ordered completions after drain/reconnect. */
	resume(clientKey: string): void;
	/** Drop completions for one abandoned client. */
	clearClient(clientKey: string): void;
	/** Drop every completion during host shutdown. */
	clear(): void;
}

/**
 * Keeps a naturally exited terminal's last output and death notice in one ordered delivery unit.
 *
 * The queue mutates only the head: once its data frame is accepted it is removed from that completion even if
 * the exit must wait for a later drain. Thus retries can neither lose the final bytes nor paint them twice.
 */
export function createTerminalCompletionQueue(push: PushToClient): TerminalCompletionQueue {
	const pending = new Map<string, TerminalCompletion[]>();

	const flush = (clientKey: string): void => {
		const completions = pending.get(clientKey);
		if (!completions) return;

		while (completions.length > 0) {
			const completion = completions[0];
			if (!completion) break;
			if (completion.data) {
				const delivery = push(clientKey, WS_CHANNELS.terminalData, completion.data);
				if (delivery === "unavailable") return;
				delete completion.data; // accepted: never replay these bytes
				if (delivery === "backpressured") return;
			}

			const delivery = push(clientKey, WS_CHANNELS.terminalExit, completion.exit);
			if (delivery === "unavailable") return;
			completions.shift(); // exit accepted: this completion is done
			if (delivery === "backpressured") break;
		}

		if (completions.length === 0) pending.delete(clientKey);
	};

	return {
		enqueue(clientKey, completion) {
			const completions = pending.get(clientKey) ?? [];
			completions.push(completion);
			pending.set(clientKey, completions);
			flush(clientKey);
		},
		resume: flush,
		clearClient(clientKey) {
			pending.delete(clientKey);
		},
		clear() {
			pending.clear();
		},
	};
}
