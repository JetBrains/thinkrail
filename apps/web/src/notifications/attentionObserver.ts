import { type AttentionCandidate, diffAttention, isLit } from "./detectAttention";
import type { AttentionEvent } from "./formatNotification";

export interface AttentionObserverInput {
	/** Whether the initial session-state snapshot has been installed yet. */
	snapshotInstalled: boolean;
	/** Advances on (re)connect; a change re-primes so a fresh snapshot never storms. */
	connectionGeneration: number;
	candidates: readonly AttentionCandidate[];
}

export interface AttentionObserver {
	observe: (input: AttentionObserverInput) => void;
}

/**
 * The rising-edge gate. It primes its lit-by-session map silently on the first observed snapshot and
 * on every reconnect (so a bulk snapshot install never fires), then emits one event per unlit→lit
 * transition. Pure of the store and DOM: the caller supplies the candidate states.
 */
export function createAttentionObserver(
	onEdge: (event: AttentionEvent) => void,
): AttentionObserver {
	let prevLit = new Map<string, boolean>();
	let primedGeneration: number | null = null;

	return {
		observe(input) {
			if (!input.snapshotInstalled) return;
			if (primedGeneration !== input.connectionGeneration) {
				primedGeneration = input.connectionGeneration;
				prevLit = new Map(input.candidates.map((c) => [c.sessionId, isLit(c.state)]));
				return;
			}
			const { events, litNow } = diffAttention(prevLit, input.candidates);
			prevLit = litNow;
			for (const event of events) onEdge(event);
		},
	};
}
