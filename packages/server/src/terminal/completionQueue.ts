import type { TerminalDataPush, TerminalExitPush } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import type { TerminalDeliveryResult } from "./outputBatcher";

export interface TerminalCompletion {
	data?: TerminalDataPush;
	exit: TerminalExitPush;
}

type PushToClient = (clientKey: string, channel: string, data: unknown) => TerminalDeliveryResult;

export interface TerminalCompletionQueue {
	enqueue(clientKey: string, completion: TerminalCompletion): void;
	resume(clientKey: string): void;
	clearClient(clientKey: string): void;
	clear(): void;
}

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
				delete completion.data;
				if (delivery === "backpressured") return;
			}

			const delivery = push(clientKey, WS_CHANNELS.terminalExit, completion.exit);
			if (delivery === "unavailable") return;
			completions.shift();
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
