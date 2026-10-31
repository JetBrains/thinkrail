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

export type BranchRequest = { generation: number; sequence: number };

type Entry = {
	generation: number;
	sequence: number;
	answered: number;
	landed: number;
	snapshot: BranchStatusSnapshot | null;
};

type Listener = () => void;

function sameReview(left: OpenBranchReview | null, right: OpenBranchReview | null): boolean {
	return (
		left !== null && right !== null && left.kind === right.kind && left.number === right.number
	);
}

export function withDivergence(
	review: OpenBranchReview,
	facts: { ahead?: number | undefined; behind?: number | undefined },
): OpenBranchReview {
	const { unpushedCommits: _ahead, behindCommits: _behind, ...reference } = review;
	const ahead = facts.ahead ?? 0;
	const behind = facts.behind ?? 0;
	return {
		...reference,
		...(ahead > 0 ? { unpushedCommits: ahead } : {}),
		...(behind > 0 ? { behindCommits: behind } : {}),
	};
}

function olderReview(review: OpenBranchReview | null, newer: BranchStatusSnapshot | null) {
	if (!review) return null;
	if (newer?.status) return withDivergence(review, newer.status);
	return withDivergence(review, {
		ahead: newer?.review?.unpushedCommits,
		behind: newer?.review?.behindCommits,
	});
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
		const created = { generation: 0, sequence: 0, answered: -1, landed: 0, snapshot: null };
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
		beginRequest(
			key: string,
			options: { supersede: boolean } = { supersede: true },
		): BranchRequest {
			const current = entry(key);
			if (options.supersede) current.generation += 1;
			current.sequence += 1;
			return { generation: current.generation, sequence: current.sequence };
		},
		resolveRequest(key: string, request: BranchRequest, answer: BranchAnswer): boolean {
			const current = entry(key);
			if (current.generation !== request.generation) return false;
			const older = request.sequence < current.landed;
			const review = older ? olderReview(answer.review, current.snapshot) : answer.review;
			const status = older ? (current.snapshot?.status ?? null) : answer.status;
			const carried =
				review !== null && sameReview(current.snapshot?.review ?? null, review)
					? current.snapshot?.url
					: undefined;
			const url = review?.url ?? carried;
			current.answered = request.generation;
			current.landed = Math.max(current.landed, request.sequence);
			publish(key, { review, ...(url ? { url } : {}), ...(status ? { status } : {}) });
			return true;
		},
		failRequest(key: string, request: BranchRequest): boolean {
			const current = entry(key);
			if (current.generation !== request.generation || current.answered === request.generation) {
				return false;
			}
			publish(key, { review: null });
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
