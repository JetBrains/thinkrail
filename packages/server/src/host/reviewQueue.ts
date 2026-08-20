// The Review All queue (task-plan-review-kebab): a per-(workspace, session) FIFO of reviewable item ids
// reviewed strictly ONE at a time. Pure mechanics — the "start one item's review" effect is injected as
// `startOne`, so this module has no agent/session dependency and is unit-testable on its own. The queue
// advances on ANY reviewer verdict for the in-flight item (approve OR changes_requested — a single pass;
// the auto-fix + auto-re-review of a requested item runs independently in the background), so a long
// worker turn never stalls the pass. In-memory: a fresh pass is another seed; a drained queue is dropped.

/** How to kick one item's agent review — injected by the host wiring (todoReview.ts). */
export type StartOne = (id: string) => Promise<unknown>;

interface ReviewQueueState {
	/** Eligible item ids not yet started, in plan order. */
	pending: string[];
	/** The item id currently in review (its verdict advances the queue), or null between items. */
	current: string | null;
}

const queues = new Map<string, ReviewQueueState>();
const keyFor = (workspaceId: string, sessionId: string): string =>
	`${workspaceId}\u0000${sessionId}`;

/** Replace the queue with `ids` (plan order). An empty seed drops any existing queue. */
export function seedReviewQueue(workspaceId: string, sessionId: string, ids: string[]): void {
	const key = keyFor(workspaceId, sessionId);
	if (ids.length === 0) {
		queues.delete(key);
		return;
	}
	queues.set(key, { pending: [...ids], current: null });
}

/**
 * Advance the queue: clear the in-flight slot and start the next eligible item via `startOne`.
 * Best-effort — a rejected `startOne` skips to the next id so one bad start never strands the whole
 * pass; a drained/absent queue is a no-op and is dropped.
 */
export async function advanceReviewQueue(
	workspaceId: string,
	sessionId: string,
	startOne: StartOne,
): Promise<void> {
	const key = keyFor(workspaceId, sessionId);
	const queue = queues.get(key);
	if (!queue) return;
	queue.current = null;
	while (queue.pending.length > 0) {
		const id = queue.pending.shift() as string;
		queue.current = id;
		try {
			await startOne(id);
			return;
		} catch (err) {
			queue.current = null;
			console.warn(`review-all: skipping ${id} (start failed): ${err}`);
		}
	}
	queues.delete(key);
}

/**
 * Called after a reviewer verdict is recorded: if `itemId` is the queue's in-flight item, kick the
 * next. Verdicts for items NOT driven by the queue (a manual single review, an auto-re-review of a
 * background item) don't advance it.
 */
export function onReviewVerdict(
	workspaceId: string,
	sessionId: string,
	itemId: string,
	startOne: StartOne,
): void {
	const queue = queues.get(keyFor(workspaceId, sessionId));
	if (!queue || queue.current !== itemId) return;
	void advanceReviewQueue(workspaceId, sessionId, startOne);
}

/** Test seam: the number of items still pending (excludes the in-flight one). */
export function reviewQueuePending(workspaceId: string, sessionId: string): number {
	return queues.get(keyFor(workspaceId, sessionId))?.pending.length ?? 0;
}

/** Test seam: the in-flight item id, or null. */
export function reviewQueueCurrent(workspaceId: string, sessionId: string): string | null {
	return queues.get(keyFor(workspaceId, sessionId))?.current ?? null;
}
