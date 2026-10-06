import type { OpenBranchReview } from "@thinkrail/contracts";

export interface RemoteCounts {
	unpushed: number;
	behind: number;
}

export function remoteCounts(review: OpenBranchReview | null): RemoteCounts | null {
	const unpushed = review?.unpushedCommits ?? 0;
	const behind = review?.behindCommits ?? 0;
	return unpushed > 0 || behind > 0 ? { unpushed, behind } : null;
}

export function projectInitial(name: string): string {
	const first = [...name.trim()][0];
	return first ? first.toLocaleUpperCase() : "?";
}

export function pluralCommits(count: number): string {
	return `${count} commit${count === 1 ? "" : "s"}`;
}
