import { expect, test } from "bun:test";
import {
	advanceReviewQueue,
	claimReviewQueue,
	onReviewerSettled,
	onReviewStartFailed,
	onReviewVerdict,
	reviewQueueActive,
	reviewQueueCurrent,
	reviewQueuePending,
	type StartOne,
	seedReviewQueue,
} from "./reviewQueue";

// The Review All queue mechanics (task-plan-review-kebab) — pure, with an injected `startOne`.
// Advancement is two-phase (host/SPEC.md): a verdict only clears the in-flight slot; the next item
// starts on the reviewer's settled turn. Every test uses a unique (workspace, session) key so the
// module's in-memory Map never collides across tests.

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

test("reviews one at a time: a verdict clears the slot, the settle starts the next, in seed order", async () => {
	const ws = "ws-a";
	const s = "sess-a";
	const { startOne, started } = recorder();
	seedReviewQueue(ws, s, ["a", "b", "c"]);
	await advanceReviewQueue(ws, s, startOne);
	expect(started).toEqual(["a"]);
	expect(reviewQueueCurrent(ws, s)).toBe("a");
	expect(reviewQueuePending(ws, s)).toBe(2);

	// The verdict alone does NOT start the next item — the reviewer's turn is still streaming.
	onReviewVerdict(ws, s, "a");
	await Promise.resolve();
	expect(started).toEqual(["a"]);
	expect(reviewQueueCurrent(ws, s)).toBeNull();

	// The settled turn does.
	onReviewerSettled(ws, s, startOne);
	await Promise.resolve();
	expect(started).toEqual(["a", "b"]);
	expect(reviewQueueCurrent(ws, s)).toBe("b");

	onReviewVerdict(ws, s, "b");
	onReviewerSettled(ws, s, startOne);
	await Promise.resolve();
	onReviewVerdict(ws, s, "c");
	onReviewerSettled(ws, s, startOne);
	await Promise.resolve();
	expect(started).toEqual(["a", "b", "c"]);
	// Drained → no queue; a stray settle is a no-op.
	expect(reviewQueueActive(ws, s)).toBe(false);
	onReviewerSettled(ws, s, startOne);
	await Promise.resolve();
	expect(started).toEqual(["a", "b", "c"]);
});

test("a settle while the verdict is still owed does not advance (stuck-review territory)", async () => {
	const ws = "ws-b2";
	const s = "sess-b2";
	const { startOne, started } = recorder();
	seedReviewQueue(ws, s, ["a", "b"]);
	await advanceReviewQueue(ws, s, startOne);
	onReviewerSettled(ws, s, startOne);
	await Promise.resolve();
	expect(started).toEqual(["a"]);
	expect(reviewQueueCurrent(ws, s)).toBe("a");
});

test("a verdict for an item that isn't in flight does not touch the queue", async () => {
	const ws = "ws-b";
	const s = "sess-b";
	const { startOne, started } = recorder();
	seedReviewQueue(ws, s, ["a", "b"]);
	await advanceReviewQueue(ws, s, startOne);
	expect(started).toEqual(["a"]);

	// A stray verdict (a manual single review / a background auto-re-review) for another item is ignored.
	onReviewVerdict(ws, s, "zzz");
	onReviewerSettled(ws, s, startOne);
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

test("an undeliverable package (onReviewStartFailed) advances past the in-flight item", async () => {
	const ws = "ws-e";
	const s = "sess-e";
	const { startOne, started } = recorder();
	seedReviewQueue(ws, s, ["a", "b"]);
	await advanceReviewQueue(ws, s, startOne);
	expect(reviewQueueCurrent(ws, s)).toBe("a");

	// The detached send for "a" was rejected — no verdict or settle will ever come for it.
	onReviewStartFailed(ws, s, "a", startOne);
	await Promise.resolve();
	expect(started).toEqual(["a", "b"]);
	expect(reviewQueueCurrent(ws, s)).toBe("b");

	// A stray failure signal for an item that isn't in flight is ignored.
	onReviewStartFailed(ws, s, "zzz", startOne);
	await Promise.resolve();
	expect(reviewQueueCurrent(ws, s)).toBe("b");
});

test("reviewQueueActive reports a live pass through both phases, false once drained", async () => {
	const ws = "ws-f";
	const s = "sess-f";
	const { startOne } = recorder();
	expect(reviewQueueActive(ws, s)).toBe(false);
	seedReviewQueue(ws, s, ["a"]);
	await advanceReviewQueue(ws, s, startOne);
	expect(reviewQueueActive(ws, s)).toBe(true);
	onReviewVerdict(ws, s, "a");
	// The last item's verdict drains the queue entirely.
	expect(reviewQueueActive(ws, s)).toBe(false);
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

test("claimReviewQueue reserves the slot synchronously — a concurrent second claim fails closed", () => {
	const ws = "ws-claim";
	const s = "sess-claim";
	// The first caller claims before its listTodos await would even resolve.
	expect(claimReviewQueue(ws, s)).toBe(true);
	// A second Review All arriving while the first is still mid-listTodos sees the claim immediately —
	// no window where both read "not active" (the bug: the old check-then-await-then-seed left exactly
	// that window, so the second call's seedReviewQueue clobbered the first's queue underneath it).
	expect(claimReviewQueue(ws, s)).toBe(false);
	expect(reviewQueueActive(ws, s)).toBe(true);

	// The first caller's listTodos resolves and seeds the real queue over the placeholder reservation.
	seedReviewQueue(ws, s, ["a", "b"]);
	expect(reviewQueuePending(ws, s)).toBe(2);

	// Once drained, the slot is free again for a genuinely new pass.
	seedReviewQueue(ws, s, []);
	expect(reviewQueueActive(ws, s)).toBe(false);
	expect(claimReviewQueue(ws, s)).toBe(true);
});

test("claimReviewQueue's reservation releases cleanly on failure (an empty seed), not stuck forever", () => {
	const ws = "ws-claim-fail";
	const s = "sess-claim-fail";
	expect(claimReviewQueue(ws, s)).toBe(true);
	expect(reviewQueueActive(ws, s)).toBe(true);
	// The equivalent of startReviewAllFlow's catch block: listTodos threw, release the claim.
	seedReviewQueue(ws, s, []);
	expect(reviewQueueActive(ws, s)).toBe(false);
	// A later Review All isn't permanently blocked by the failed attempt.
	expect(claimReviewQueue(ws, s)).toBe(true);
});

test("a stale reviewer settle during the claim window does not evict the placeholder (todoReview.ts's pinned reviewer chat outlives one pass, so its next settle can land mid-listTodos)", () => {
	const ws = "ws-claim-settle-race";
	const s = "sess-claim-settle-race";
	const calls: string[] = [];
	const startOne: StartOne = async (id) => {
		calls.push(id);
	};

	// A Review All claims the slot; listTodos is still pending (nothing seeded yet).
	expect(claimReviewQueue(ws, s)).toBe(true);

	// The plan's pinned reviewer chat — reused across passes — settles again for an unrelated reason
	// (e.g. a leftover auto-re-review retry) while listTodos is still in flight. Before the CLAIMING
	// sentinel, onReviewerSettled saw `current === null` and deleted the fresh placeholder here,
	// reopening the window for a second concurrent claimReviewQueue to slip through underneath it.
	onReviewerSettled(ws, s, startOne);
	expect(reviewQueueActive(ws, s)).toBe(true);
	expect(claimReviewQueue(ws, s)).toBe(false);
	expect(calls).toEqual([]);

	// listTodos resolves and seeds the real queue over the still-intact placeholder, same as any pass.
	seedReviewQueue(ws, s, ["a"]);
	expect(reviewQueuePending(ws, s)).toBe(1);
});
