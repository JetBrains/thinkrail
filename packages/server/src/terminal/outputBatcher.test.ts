import { describe, expect, test } from "bun:test";
import { createOutputBatcher, type OutputBatcherOptions } from "./outputBatcher";

/** A batcher plus the batches it delivered. `deliverable` flips to simulate a receiver going away. */
function harness(overrides: Partial<OutputBatcherOptions> = {}) {
	const flushed: { data: string; truncated: boolean }[] = [];
	const state = { deliverable: true };
	const batcher = createOutputBatcher({
		flushMs: 8,
		maxBatchChars: 64,
		maxPendingChars: 256,
		onFlush: (batch) => {
			if (!state.deliverable) return false;
			flushed.push(batch);
			return true;
		},
		...overrides,
	});
	return { batcher, flushed, state };
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("output batcher", () => {
	test("collapses a burst of chunks into one batch", async () => {
		const { batcher, flushed } = harness();

		for (const chunk of ["a", "b", "c", "d"]) batcher.push(chunk);
		expect(flushed).toHaveLength(0); // nothing delivered yet — still inside the flush window

		await tick(20);
		expect(flushed).toEqual([{ data: "abcd", truncated: false }]);
	});

	test("flushes early once a batch is big enough, without waiting out the timer", () => {
		const { batcher, flushed } = harness({ maxBatchChars: 4 });

		batcher.push("abc");
		expect(flushed).toHaveLength(0);
		batcher.push("d"); // reaches maxBatchChars
		expect(flushed).toEqual([{ data: "abcd", truncated: false }]);
	});

	test("keeps output when the receiver is away, and delivers it on resume", async () => {
		const { batcher, flushed, state } = harness();

		state.deliverable = false;
		batcher.push("while-away");
		await tick(20);
		expect(flushed).toHaveLength(0); // held, not dropped

		state.deliverable = true;
		batcher.resume();
		expect(flushed).toEqual([{ data: "while-away", truncated: false }]);
	});

	test("drops the OLDEST output past the ceiling and says so", async () => {
		const { batcher, flushed, state } = harness({ maxPendingChars: 10, maxBatchChars: 1000 });

		state.deliverable = false;
		batcher.push("0123456789");
		batcher.push("ABCDE"); // overflows: the oldest 5 characters go
		state.deliverable = true;
		batcher.resume();

		// The tail survives — on a terminal that is the part the user is waiting to see.
		expect(flushed).toEqual([{ data: "56789ABCDE", truncated: true }]);
	});

	test("a delivered batch clears the truncation flag rather than latching it", async () => {
		const { batcher, flushed, state } = harness({ maxPendingChars: 4, maxBatchChars: 1000 });

		state.deliverable = false;
		batcher.push("overflowing");
		state.deliverable = true;
		batcher.resume();
		expect(flushed[0]?.truncated).toBe(true);

		batcher.push("ok");
		await tick(20);
		expect(flushed[1]).toEqual({ data: "ok", truncated: false });
	});

	test("dispose drops pending output for good", async () => {
		const { batcher, flushed } = harness();

		batcher.push("gone");
		batcher.dispose();

		// Not delivered by the flush that was already scheduled...
		await tick(20);
		expect(flushed).toHaveLength(0);
		// ...and not resurrected by a later resume either, which is what would surface it if dispose had only
		// cancelled the timer and left the buffer sitting there.
		batcher.resume();
		expect(flushed).toHaveLength(0);

		// The batcher is still coherent afterwards: a fresh push flushes on its own schedule.
		batcher.push("after");
		await tick(20);
		expect(flushed).toEqual([{ data: "after", truncated: false }]);
	});
});
