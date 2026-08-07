// Batches one PTY's output into whole frames. Timer-only and transport-free, so it's unit-testable: chunks
// accumulate and flush as ONE string, and a flush the caller can't deliver stays pending until it can.

export type TerminalDeliveryResult = "delivered" | "backpressured" | "unavailable";

export interface OutputBatch {
	data: string;
	truncated: boolean;
}

export interface OutputBatcherOptions {
	/**
	 * How long after the first chunk of a batch to flush. This is the latency a keystroke echo pays, so it is
	 * deliberately about one display frame — long enough to collapse a burst, short enough to feel immediate.
	 */
	flushMs: number;
	/** Flush early once a batch reaches this many characters, so a flood stays responsive instead of bursty. */
	maxBatchChars: number;
	/**
	 * Ceiling on output held while the receiver is away. Past it the OLDEST characters are dropped and the next
	 * flush is marked truncated: a shell can emit unboundedly fast (`yes`, `cat` of a huge file) and the PTY
	 * cannot be paused (`bun-pty` exposes no `pause()`, and its read loop starts at spawn), so *something* has
	 * to give. Losing the start of a flood and saying so beats growing until the host dies.
	 */
	maxPendingChars: number;
	/**
	 * Deliver a batch. `backpressured` means this batch was accepted but no successor may be sent yet;
	 * `unavailable` means this batch was not accepted and must remain pending.
	 */
	onFlush: (batch: OutputBatch) => TerminalDeliveryResult;
}

export interface OutputBatcher {
	/** Record a chunk of PTY output. */
	push(chunk: string): void;
	/** Retry held output after the receiver becomes writable (drain/reconnect). */
	resume(): void;
	/** Retire the batcher and transfer its final pending output to the exit-completion queue. */
	finish(): OutputBatch | undefined;
	/** Retire the batcher and drop pending output (an intentional PTY teardown). */
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

		// Hand the batch over optimistically, then put it back only when the receiver did not accept it. Both
		// unavailable and accepted-with-backpressure latch the batcher until an explicit resume; otherwise a
		// flood would keep calling send while Bun has told us to stop.
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
				// Keep the NEWEST output: on a terminal the tail is what the user is waiting to see.
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
		finish,
		dispose() {
			finish();
		},
	};
}
