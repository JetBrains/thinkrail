export type StartOne = (id: string) => Promise<unknown>;

interface ReviewQueueState {
	pending: string[];
	current: string | null;
}

const queues = new Map<string, ReviewQueueState>();
const keyFor = (workspaceId: string, sessionId: string): string =>
	`${workspaceId}\u0000${sessionId}`;
// `current` sentinel for "claimed, listTodos still pending" — never a real item id; see host/SPEC.md
// (Review All / claimReviewQueue) for why the claim window must not read as an idle queue.
const CLAIMING = "\u0000claiming";

export function seedReviewQueue(workspaceId: string, sessionId: string, ids: string[]): void {
	const key = keyFor(workspaceId, sessionId);
	if (ids.length === 0) {
		queues.delete(key);
		return;
	}
	queues.set(key, { pending: [...ids], current: null });
}

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

export function onReviewVerdict(workspaceId: string, sessionId: string, itemId: string): void {
	const key = keyFor(workspaceId, sessionId);
	const queue = queues.get(key);
	if (!queue || queue.current !== itemId) return;
	queue.current = null;
	if (queue.pending.length === 0) queues.delete(key);
}

export function onReviewerSettled(
	workspaceId: string,
	sessionId: string,
	startOne: StartOne,
): void {
	const queue = queues.get(keyFor(workspaceId, sessionId));
	if (!queue || queue.current !== null) return;
	void advanceReviewQueue(workspaceId, sessionId, startOne);
}

export function onReviewStartFailed(
	workspaceId: string,
	sessionId: string,
	itemId: string,
	startOne: StartOne,
): void {
	const queue = queues.get(keyFor(workspaceId, sessionId));
	if (!queue || queue.current !== itemId) return;
	void advanceReviewQueue(workspaceId, sessionId, startOne);
}

export function reviewQueueActive(workspaceId: string, sessionId: string): boolean {
	return queues.has(keyFor(workspaceId, sessionId));
}

export function claimReviewQueue(workspaceId: string, sessionId: string): boolean {
	const key = keyFor(workspaceId, sessionId);
	if (queues.has(key)) return false;
	queues.set(key, { pending: [], current: CLAIMING });
	return true;
}

export function reviewQueuesEmpty(): boolean {
	return queues.size === 0;
}

export function reviewQueuePending(workspaceId: string, sessionId: string): number {
	return queues.get(keyFor(workspaceId, sessionId))?.pending.length ?? 0;
}

export function reviewQueueCurrent(workspaceId: string, sessionId: string): string | null {
	const current = queues.get(keyFor(workspaceId, sessionId))?.current ?? null;
	return current === CLAIMING ? null : current;
}
