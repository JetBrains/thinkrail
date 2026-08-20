export type TerminalDeliveryResult = "delivered" | "backpressured" | "unavailable";

export interface OutputBatch {
	data: string;
	truncated: boolean;
}

export interface OutputBatcherOptions {
	flushMs: number;
	maxBatchChars: number;
	maxPendingChars: number;
	onFlush: (batch: OutputBatch) => TerminalDeliveryResult;
}

export interface OutputBatcher {
	push(chunk: string): void;
	resume(): void;
	reset(): void;
	finish(): OutputBatch | undefined;
	dispose(): void;
}

export function createOutputBatcher(options: OutputBatcherOptions): OutputBatcher {
	const { flushMs, maxBatchChars, maxPendingChars, onFlush } = options;
	let pending = "";
	let truncated = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let blocked = false;
	let disposed = false;

	const clearTimer = (): void => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};

	const flush = (): void => {
		clearTimer();
		if (disposed || blocked || pending === "") return;

		const batch = { data: pending, truncated };
		pending = "";
		truncated = false;
		const delivery = onFlush(batch);
		if (delivery === "delivered") return;
		blocked = true;
		if (delivery === "unavailable") {
			pending = batch.data;
			truncated = batch.truncated;
		}
	};

	const finish = (): OutputBatch | undefined => {
		if (disposed) return undefined;
		clearTimer();
		disposed = true;
		if (pending === "") return undefined;
		const finalBatch = { data: pending, truncated };
		pending = "";
		truncated = false;
		return finalBatch;
	};

	return {
		push(chunk) {
			if (disposed || chunk === "") return;
			pending += chunk;
			if (pending.length > maxPendingChars) {
				pending = pending.slice(pending.length - maxPendingChars);
				truncated = true;
			}
			if (blocked) return;
			if (pending.length >= maxBatchChars) {
				flush();
				return;
			}
			if (timer === null) timer = setTimeout(flush, flushMs);
		},
		resume() {
			if (disposed) return;
			blocked = false;
			flush();
		},
		reset() {
			if (disposed) return;
			clearTimer();
			pending = "";
			truncated = false;
			blocked = false;
		},
		finish,
		dispose() {
			finish();
		},
	};
}
