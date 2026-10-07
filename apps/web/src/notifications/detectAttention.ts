import type { SessionState } from "@thinkrail/contracts";
import type { AttentionEvent, AttentionReason } from "./formatNotification";

/** The green attention dot: a session is waiting for input or has an unread completion. */
export function isLit(state: SessionState): boolean {
	return state.needsInput !== null || state.completionUnread;
}

export function attentionReason(state: SessionState): AttentionReason | null {
	if (state.needsInput !== null) return { kind: "needs-input" };
	if (state.completionUnread && state.completion) {
		return { kind: "completed", completion: state.completion };
	}
	return null;
}

export interface AttentionCandidate {
	sessionId: string;
	workspaceId: string;
	worktreeName: string;
	state: SessionState;
}

export interface AttentionDiff {
	events: AttentionEvent[];
	litNow: Map<string, boolean>;
}

/**
 * Compare the previous lit-by-session map against the current session states and emit one event per
 * rising edge (unlit → lit). A session that stays lit through a reason change is not a new edge.
 * Returns the fresh map for the next diff.
 */
export function diffAttention(
	prevLit: ReadonlyMap<string, boolean>,
	candidates: readonly AttentionCandidate[],
): AttentionDiff {
	const litNow = new Map<string, boolean>();
	const events: AttentionEvent[] = [];
	for (const candidate of candidates) {
		const lit = isLit(candidate.state);
		litNow.set(candidate.sessionId, lit);
		if (!lit || prevLit.get(candidate.sessionId)) continue;
		const reason = attentionReason(candidate.state);
		if (!reason) continue;
		events.push({
			sessionId: candidate.sessionId,
			workspaceId: candidate.workspaceId,
			worktreeName: candidate.worktreeName,
			reason,
		});
	}
	return { events, litNow };
}
