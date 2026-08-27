import type { OpenBranchReview } from "@thinkrail/contracts";

export type OpenBranchReviewSnapshot = {
	review: OpenBranchReview | null;
	url?: string;
};

type Entry = {
	generation: number;
	snapshot: OpenBranchReviewSnapshot | null;
};

type Listener = () => void;

function sameReview(left: OpenBranchReview | null, right: OpenBranchReview | null): boolean {
	return (
		left !== null && right !== null && left.kind === right.kind && left.number === right.number
	);
}

export function createOpenBranchReviewState() {
	const entries = new Map<string, Entry>();
	const listeners = new Map<string, Set<Listener>>();
	const entry = (key: string): Entry => {
		const existing = entries.get(key);
		if (existing) return existing;
		const created = { generation: 0, snapshot: null };
		entries.set(key, created);
		return created;
	};
	const publish = (key: string, snapshot: OpenBranchReviewSnapshot): void => {
		entry(key).snapshot = snapshot;
		for (const listener of listeners.get(key) ?? []) listener();
	};

	return {
		getSnapshot(key: string): OpenBranchReviewSnapshot | null {
			return entries.get(key)?.snapshot ?? null;
		},
		subscribe(key: string, listener: Listener): () => void {
			const current = listeners.get(key) ?? new Set<Listener>();
			current.add(listener);
			listeners.set(key, current);
			return () => {
				current.delete(listener);
				if (current.size === 0) listeners.delete(key);
			};
		},
		beginRequest(key: string): number {
			const current = entry(key);
			current.generation += 1;
			return current.generation;
		},
		resolveRequest(key: string, generation: number, review: OpenBranchReview | null): boolean {
			const current = entry(key);
			if (current.generation !== generation) return false;
			const url =
				review !== null && sameReview(current.snapshot?.review ?? null, review)
					? current.snapshot?.url
					: undefined;
			publish(key, { review, ...(url ? { url } : {}) });
			return true;
		},
		noteOpenReview(key: string, review: OpenBranchReview, url?: string): void {
			const current = entry(key);
			current.generation += 1;
			publish(key, { review, ...(url ? { url } : {}) });
		},
	};
}

export type OpenBranchReviewStateStore = ReturnType<typeof createOpenBranchReviewState>;

export const openBranchReviewState = createOpenBranchReviewState();
