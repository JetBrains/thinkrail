import type { WorkspaceSkillChange } from "@thinkrail/contracts";

export interface CoalescerOptions {
	quietMs: number;
	maxWaitMs: number;
	maxPaths: number;
	onFlush: (batch: {
		paths: string[];
		truncated: boolean;
		skillChange: WorkspaceSkillChange;
	}) => void;
}

export interface Coalescer {
	add(path: string | null, skillChange: WorkspaceSkillChange): void;
	dispose(): void;
}

export function createCoalescer(options: CoalescerOptions): Coalescer {
	const { quietMs, maxWaitMs, maxPaths, onFlush } = options;
	let pending = new Set<string>();
	let truncated = false;
	let skillChange: WorkspaceSkillChange = "none";
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
		if (pending.size === 0 && !truncated && skillChange === "none") return;
		const batch = { paths: [...pending], truncated, skillChange };
		pending = new Set();
		truncated = false;
		skillChange = "none";
		onFlush(batch);
	};

	return {
		add(path, eventSkillChange) {
			if (eventSkillChange === "detected" || skillChange === "none") {
				skillChange = eventSkillChange;
			}
			if (path === null) truncated = true;
			else if (pending.has(path)) {
			} else if (pending.size >= maxPaths) truncated = true;
			else pending.add(path);
			if (quietTimer) clearTimeout(quietTimer);
			quietTimer = setTimeout(flush, quietMs);
			if (!maxTimer) maxTimer = setTimeout(flush, maxWaitMs);
		},
		dispose() {
			clearTimers();
			pending = new Set();
			truncated = false;
			skillChange = "none";
		},
	};
}
