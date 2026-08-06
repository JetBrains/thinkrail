// Batches one PTY's output into whole frames. Timer-only and transport-free, so it's unit-testable: chunks
// accumulate and flush as ONE string, and a flush the caller can't deliver stays pending until it can.

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
	/** Deliver a batch. Return false if the receiver is currently unreachable — the batch is then kept. */
	onFlush: (batch: { data: string; truncated: boolean }) => boolean;
}

export interface OutputBatcher {
	/** Record a chunk of PTY output. */
	push(chunk: string): void;
	/** Try to deliver anything held back (the receiver just became reachable again). */
	resume(): void;
	/** Drop pending output + timers without delivering (the PTY is gone). */
	dispose(): void;
}

export function createOutputBatcher(options: OutputBatcherOptions): OutputBatcher {
	const { flushMs, maxBatchChars, maxPendingChars, onFlush } = options;
	let pending = "";
	let truncated = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const clearTimer = (): void => {
		if (timer) clearTimeout(timer);
		timer = null;
	};

	const flush = (): void => {
		clearTimer();
		if (pending === "") return;
		// Hand the batch over optimistically, then put it back if the receiver couldn't take it — so an
		// undeliverable batch is retried rather than dropped (a brief reconnect keeps its output).
		const batch = { data: pending, truncated };
		pending = "";
		truncated = false;
		if (onFlush(batch)) return;
		pending = batch.data;
		truncated = batch.truncated;
	};

	return {
		push(chunk) {
			if (chunk === "") return;
			pending += chunk;
			if (pending.length > maxPendingChars) {
				// Keep the NEWEST output: on a terminal the tail is what the user is waiting to see.
				pending = pending.slice(pending.length - maxPendingChars);
				truncated = true;
			}
			if (pending.length >= maxBatchChars) {
				flush();
				return;
			}
			if (!timer) timer = setTimeout(flush, flushMs);
		},
		resume() {
			flush();
		},
		dispose() {
			clearTimer();
			pending = "";
			truncated = false;
		},
	};
}
