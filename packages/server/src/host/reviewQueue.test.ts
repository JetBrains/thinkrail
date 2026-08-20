import { expect, test } from "bun:test";
import {
	advanceReviewQueue,
	onReviewVerdict,
	reviewQueueCurrent,
	reviewQueuePending,
	type StartOne,
	seedReviewQueue,
} from "./reviewQueue";

// The Review All queue mechanics (task-plan-review-kebab) — pure, with an injected `startOne`. Every
// test uses a unique (workspace, session) key so the module's in-memory Map never collides across tests.

/** Records the order `startOne` was invoked in; resolves so the queue keeps its invariant simple. */
function recorder(): { startOne: StartOne; started: string[] } {
	const started: string[] = [];
	return {
		started,
		startOne: async (id) => {
			started.push(id);
		},
	};
}

test("reviews one at a time, advancing on each verdict, in seed order", async () => {
	const ws = "ws-a";
	const s = "sess-a";
	const { startOne, started } = recorder();
	seedReviewQueue(ws, s, ["a", "b", "c"]);
	await advanceReviewQueue(ws, s, startOne);
	// Only the first is in flight; the rest wait.
	expect(started).toEqual(["a"]);
	expect(reviewQueueCurrent(ws, s)).toBe("a");
	expect(reviewQueuePending(ws, s)).toBe(2);

	// A verdict for the in-flight item kicks the next.
	onReviewVerdict(ws, s, "a", startOne);
	await Promise.resolve();
	expect(started).toEqual(["a", "b"]);
	expect(reviewQueueCurrent(ws, s)).toBe("b");

	onReviewVerdict(ws, s, "b", startOne);
	await Promise.resolve();
	onReviewVerdict(ws, s, "c", startOne);
	await Promise.resolve();
	expect(started).toEqual(["a", "b", "c"]);
	// Drained → no queue.
	expect(reviewQueueCurrent(ws, s)).toBeNull();
	expect(reviewQueuePending(ws, s)).toBe(0);
});

test("a verdict for an item that isn't in flight does not advance the queue", async () => {
	const ws = "ws-b";
	const s = "sess-b";
	const { startOne, started } = recorder();
	seedReviewQueue(ws, s, ["a", "b"]);
	await advanceReviewQueue(ws, s, startOne);
	expect(started).toEqual(["a"]);

	// A stray verdict (a manual single review / a background auto-re-review) for another item is ignored.
	onReviewVerdict(ws, s, "zzz", startOne);
	await Promise.resolve();
	expect(started).toEqual(["a"]);
	expect(reviewQueueCurrent(ws, s)).toBe("a");
});

test("a failing startOne skips to the next item instead of stranding the pass", async () => {
	const ws = "ws-c";
	const s = "sess-c";
	const started: string[] = [];
	const startOne: StartOne = async (id) => {
		started.push(id);
		if (id === "a") throw new Error("boom");
	};
	seedReviewQueue(ws, s, ["a", "b"]);
	await advanceReviewQueue(ws, s, startOne);
	// "a" threw, so the queue rolled straight on to "b".
	expect(started).toEqual(["a", "b"]);
	expect(reviewQueueCurrent(ws, s)).toBe("b");
});

test("an empty seed drops the queue", async () => {
	const ws = "ws-d";
	const s = "sess-d";
	const { startOne } = recorder();
	seedReviewQueue(ws, s, []);
	await advanceReviewQueue(ws, s, startOne);
	expect(reviewQueueCurrent(ws, s)).toBeNull();
	expect(reviewQueuePending(ws, s)).toBe(0);
});
