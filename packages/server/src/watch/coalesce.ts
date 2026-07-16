// The debounce/coalesce core of the worktree change notifier, kept timer-only and fs-free so it's
// unit-testable: paths accumulate into a deduped set and flush as ONE batch after a quiet gap, with a
// max-wait bound so continuous churn (a build, `git checkout`) still flushes periodically.

export interface CoalescerOptions {
	/** Flush after this long with no new events. */
	quietMs: number;
	/** Flush at least this often under continuous events. */
	maxWaitMs: number;
	/** Cap the batch; beyond it the batch turns `truncated` (= wildcard, receivers refetch everything). */
	maxPaths: number;
	onFlush: (batch: { paths: string[]; truncated: boolean }) => void;
}

export interface Coalescer {
	/** Record one changed path (worktree-relative); `null` = unknown path → the batch turns truncated. */
	add(path: string | null): void;
	/** Drop pending state + timers without flushing (watcher teardown). */
	dispose(): void;
}

export function createCoalescer(options: CoalescerOptions): Coalescer {
	const { quietMs, maxWaitMs, maxPaths, onFlush } = options;
	let pending = new Set<string>();
	let truncated = false;
	let quietTimer: ReturnType<typeof setTimeout> | null = null;
	let maxTimer: ReturnType<typeof setTimeout> | null = null;

	const clearTimers = (): void => {
		if (quietTimer) clearTimeout(quietTimer);
		if (maxTimer) clearTimeout(maxTimer);
		quietTimer = null;
		maxTimer = null;
	};

	const flush = (): void => {
		clearTimers();
		if (pending.size === 0 && !truncated) return;
		const batch = { paths: [...pending], truncated };
		pending = new Set();
		truncated = false;
		onFlush(batch);
	};

	return {
		add(path) {
			if (path === null) truncated = true;
			else if (pending.size >= maxPaths) truncated = true;
			else pending.add(path);
			if (quietTimer) clearTimeout(quietTimer);
			quietTimer = setTimeout(flush, quietMs);
			if (!maxTimer) maxTimer = setTimeout(flush, maxWaitMs);
		},
		dispose() {
			clearTimers();
			pending = new Set();
			truncated = false;
		},
	};
}
