import type { BranchStatus, OpenBranchReview } from "@thinkrail/contracts";

export type BranchFacts = Omit<BranchStatus, "review">;

export type BranchStatusSnapshot = {
	review: OpenBranchReview | null;
	url?: string;
	status?: BranchFacts;
	discovery?: number;
};

export const CI_DISCOVERY_POLLS = 3;

export type BranchAnswer = { review: OpenBranchReview | null; status: BranchFacts | null };

type Entry = {
	generation: number;
	snapshot: BranchStatusSnapshot | null;
};

type Listener = () => void;

function sameReview(left: OpenBranchReview | null, right: OpenBranchReview | null): boolean {
	return (
		left !== null && right !== null && left.kind === right.kind && left.number === right.number
	);
}

function withoutDiscovery({ discovery: _spent, ...snapshot }: BranchStatusSnapshot) {
	return snapshot;
}

export function createBranchStatusState() {
	const entries = new Map<string, Entry>();
	const listeners = new Map<string, Set<Listener>>();
	const entry = (key: string): Entry => {
		const existing = entries.get(key);
		if (existing) return existing;
		const created = { generation: 0, snapshot: null };
		entries.set(key, created);
		return created;
	};
	const publish = (key: string, snapshot: BranchStatusSnapshot): void => {
		const discovery = snapshot.discovery ?? entry(key).snapshot?.discovery ?? 0;
		entry(key).snapshot = discovery > 0 ? { ...snapshot, discovery } : withoutDiscovery(snapshot);
		for (const listener of listeners.get(key) ?? []) listener();
	};
	const setDiscovery = (key: string, discovery: number): void => {
		const snapshot = entry(key).snapshot ?? { review: null };
		entry(key).snapshot = discovery > 0 ? { ...snapshot, discovery } : withoutDiscovery(snapshot);
		for (const listener of listeners.get(key) ?? []) listener();
	};

	return {
		getSnapshot(key: string): BranchStatusSnapshot | null {
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
		resolveRequest(key: string, generation: number, answer: BranchAnswer): boolean {
			const current = entry(key);
			if (current.generation !== generation) return false;
			const { review, status } = answer;
			const carried =
				review !== null && sameReview(current.snapshot?.review ?? null, review)
					? current.snapshot?.url
					: undefined;
			const url = review?.url ?? carried;
			publish(key, { review, ...(url ? { url } : {}), ...(status ? { status } : {}) });
			return true;
		},
		startDiscovery(key: string): void {
			setDiscovery(key, CI_DISCOVERY_POLLS);
		},
		spendDiscovery(key: string): void {
			setDiscovery(key, Math.max(0, (entry(key).snapshot?.discovery ?? 0) - 1));
		},
		noteOpenReview(key: string, review: OpenBranchReview, url?: string): void {
			const current = entry(key);
			current.generation += 1;
			const resolved = url ?? review.url;
			const status = current.snapshot?.status;
			publish(key, {
				review,
				...(resolved ? { url: resolved } : {}),
				...(status ? { status } : {}),
			});
		},
	};
}

export type BranchStatusStateStore = ReturnType<typeof createBranchStatusState>;

export const branchStatusState = createBranchStatusState();
