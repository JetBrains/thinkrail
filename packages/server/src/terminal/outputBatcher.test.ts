import { describe, expect, test } from "bun:test";
import {
	createOutputBatcher,
	type OutputBatcherOptions,
	type TerminalDeliveryResult,
} from "./outputBatcher";

/** A batcher plus accepted batches. `delivery` flips to simulate receiver/backpressure state. */
function harness(overrides: Partial<OutputBatcherOptions> = {}) {
	const accepted: { data: string; truncated: boolean }[] = [];
	const attempts: { data: string; truncated: boolean }[] = [];
	const state: { delivery: TerminalDeliveryResult } = { delivery: "delivered" };
	const batcher = createOutputBatcher({
		flushMs: 8,
		maxBatchChars: 64,
		maxPendingChars: 256,
		onFlush: (batch) => {
			attempts.push(batch);
			if (state.delivery !== "unavailable") accepted.push(batch);
			return state.delivery;
		},
		...overrides,
	});
	return { accepted, attempts, batcher, state };
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("output batcher", () => {
	test("collapses a burst of chunks into one batch", async () => {
		const { batcher, accepted } = harness();

		for (const chunk of ["a", "b", "c", "d"]) batcher.push(chunk);
		expect(accepted).toHaveLength(0); // nothing delivered yet — still inside the flush window

		await tick(20);
		expect(accepted).toEqual([{ data: "abcd", truncated: false }]);
	});

	test("flushes early once a batch is big enough, without waiting out the timer", () => {
		const { batcher, accepted } = harness({ maxBatchChars: 4 });

		batcher.push("abc");
		expect(accepted).toHaveLength(0);
		batcher.push("d"); // reaches maxBatchChars
		expect(accepted).toEqual([{ data: "abcd", truncated: false }]);
	});

	test("keeps unavailable output and retries it only on resume", async () => {
		const { accepted, attempts, batcher, state } = harness();

		state.delivery = "unavailable";
		batcher.push("while-away");
		await tick(20);
		batcher.push("-more");
		await tick(20);
		expect(accepted).toHaveLength(0);
		expect(attempts).toHaveLength(1); // blocked is latched; a flood does not keep calling send

		state.delivery = "delivered";
		batcher.resume();
		expect(accepted).toEqual([{ data: "while-away-more", truncated: false }]);
	});

	test("treats a backpressured batch as accepted but blocks its successor until resume", async () => {
		const { accepted, attempts, batcher, state } = harness({ maxBatchChars: 5 });

		state.delivery = "backpressured";
		batcher.push("first");
		expect(accepted).toEqual([{ data: "first", truncated: false }]);
		batcher.push("second");
		await tick(20);
		expect(attempts).toHaveLength(1); // first was accepted; second stays local while blocked

		state.delivery = "delivered";
		batcher.resume();
		expect(accepted).toEqual([
			{ data: "first", truncated: false },
			{ data: "second", truncated: false },
		]);
	});

	test("drops the OLDEST output past the ceiling and says so", () => {
		const { accepted, batcher, state } = harness({ maxPendingChars: 10, maxBatchChars: 1000 });

		state.delivery = "unavailable";
		batcher.push("0123456789");
		batcher.push("ABCDE"); // overflows: the oldest 5 characters go
		state.delivery = "delivered";
		batcher.resume();

		// The tail survives — on a terminal that is the part the user is waiting to see.
		expect(accepted).toEqual([{ data: "56789ABCDE", truncated: true }]);
	});

	test("a delivered batch clears the truncation flag rather than latching it", async () => {
		const { accepted, batcher, state } = harness({ maxPendingChars: 4, maxBatchChars: 1000 });

		state.delivery = "unavailable";
		batcher.push("overflowing");
		state.delivery = "delivered";
		batcher.resume();
		expect(accepted[0]?.truncated).toBe(true);

		batcher.push("ok");
		await tick(20);
		expect(accepted[1]).toEqual({ data: "ok", truncated: false });
	});

	test("finish transfers pending output once and permanently retires the batcher", async () => {
		const { accepted, batcher, state } = harness();

		state.delivery = "unavailable";
		batcher.push("final");
		await tick(20);
		expect(batcher.finish()).toEqual({ data: "final", truncated: false });
		expect(batcher.finish()).toBeUndefined();

		state.delivery = "delivered";
		batcher.resume();
		batcher.push("after");
		await tick(20);
		expect(accepted).toHaveLength(0);
	});

	test("dispose drops pending output and permanently retires the batcher", async () => {
		const { accepted, batcher } = harness();

		batcher.push("gone");
		batcher.dispose();
		await tick(20);
		batcher.resume();
		batcher.push("after");
		await tick(20);
		expect(accepted).toHaveLength(0);
	});
});
