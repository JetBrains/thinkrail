const chains = new Map<string, Promise<void>>();
const active = new Set<string>();

const planKey = (workspaceId: string, sessionId: string): string =>
	JSON.stringify([workspaceId, sessionId]);
const itemKey = (sessionId: string, itemId: string): string => JSON.stringify([sessionId, itemId]);

export function planReviewRunning(workspaceId: string, sessionId: string): boolean {
	return chains.has(planKey(workspaceId, sessionId));
}

export function itemReviewActive(sessionId: string, itemId: string): boolean {
	return active.has(itemKey(sessionId, itemId));
}

export function claimItemReview(sessionId: string, itemId: string): boolean {
	const item = itemKey(sessionId, itemId);
	if (active.has(item)) return false;
	active.add(item);
	return true;
}

export function releaseItemReview(sessionId: string, itemId: string): void {
	active.delete(itemKey(sessionId, itemId));
}

/** Serialize `run` onto the plan's chain and resolve with its result — the one-review-per-plan ordering
 * both entry points share. The caller owns the item claim; errors propagate to the caller (unlike
 * `enqueuePlanReview`, which swallows them for the detached button path). See planReview.SPEC.md. */
export function onPlanChain<T>(
	workspaceId: string,
	sessionId: string,
	run: () => Promise<T>,
): Promise<T> {
	const plan = planKey(workspaceId, sessionId);
	const result = (chains.get(plan) ?? Promise.resolve()).then(run);
	const next = result
		.then(
			() => {},
			() => {},
		)
		.finally(() => {
			if (chains.get(plan) === next) chains.delete(plan);
		});
	chains.set(plan, next);
	return result;
}

export function enqueuePlanReview(
	workspaceId: string,
	sessionId: string,
	itemId: string,
	run: () => Promise<void>,
): boolean {
	const item = itemKey(sessionId, itemId);
	if (!claimItemReview(sessionId, itemId)) return false;
	onPlanChain(workspaceId, sessionId, run)
		.catch((err) => {
			console.warn(`plan review failed (${itemId}): ${err instanceof Error ? err.message : err}`);
		})
		.finally(() => {
			active.delete(item);
		});
	return true;
}
