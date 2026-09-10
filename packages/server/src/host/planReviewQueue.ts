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

export function enqueuePlanReview(
	workspaceId: string,
	sessionId: string,
	itemId: string,
	run: () => Promise<void>,
): boolean {
	const item = itemKey(sessionId, itemId);
	if (!claimItemReview(sessionId, itemId)) return false;
	const plan = planKey(workspaceId, sessionId);
	const next = (chains.get(plan) ?? Promise.resolve())
		.then(run)
		.catch((err) => {
			console.warn(`plan review failed (${itemId}): ${err instanceof Error ? err.message : err}`);
		})
		.finally(() => {
			active.delete(item);
			if (chains.get(plan) === next) chains.delete(plan);
		});
	chains.set(plan, next);
	return true;
}
