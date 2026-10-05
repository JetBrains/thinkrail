import { describe, expect, test } from "bun:test";
import type { SessionState } from "@thinkrail/contracts";
import { createAttentionObserver } from "./attentionObserver";
import type { AttentionCandidate } from "./detectAttention";
import type { AttentionEvent } from "./formatNotification";

function state(overrides: Partial<SessionState> = {}): SessionState {
	return {
		execution: "idle",
		runId: null,
		needsInput: null,
		completion: null,
		completionUnread: false,
		queuedCount: 0,
		...overrides,
	};
}

const lit = state({ needsInput: { interactionId: "i", kind: "question" } });

function candidate(sessionId: string, s: SessionState): AttentionCandidate {
	return { sessionId, workspaceId: "w1", worktreeName: "branch", state: s };
}

describe("createAttentionObserver", () => {
	function harness() {
		const events: AttentionEvent[] = [];
		const observer = createAttentionObserver((e) => events.push(e));
		return { events, observer };
	}

	test("does nothing before the snapshot is installed", () => {
		const { events, observer } = harness();
		observer.observe({
			snapshotInstalled: false,
			connectionGeneration: 1,
			candidates: [candidate("s1", lit)],
		});
		expect(events).toHaveLength(0);
	});

	test("primes silently on the first installed snapshot, then emits later edges", () => {
		const { events, observer } = harness();
		// Already-lit session at first snapshot must NOT notify (storm suppression).
		observer.observe({
			snapshotInstalled: true,
			connectionGeneration: 1,
			candidates: [candidate("s1", lit)],
		});
		expect(events).toHaveLength(0);
		// A new session lighting up afterwards is a real edge.
		observer.observe({
			snapshotInstalled: true,
			connectionGeneration: 1,
			candidates: [candidate("s1", lit), candidate("s2", lit)],
		});
		expect(events.map((e) => e.sessionId)).toEqual(["s2"]);
	});

	test("a reconnect re-primes so the fresh snapshot never storms", () => {
		const { events, observer } = harness();
		observer.observe({
			snapshotInstalled: true,
			connectionGeneration: 1,
			candidates: [candidate("s1", state())],
		});
		// Reconnect: generation bumps and the snapshot comes back with s1 already lit.
		observer.observe({
			snapshotInstalled: true,
			connectionGeneration: 2,
			candidates: [candidate("s1", lit)],
		});
		expect(events).toHaveLength(0);
	});

	test("an unlit snapshot never emits across repeated observations", () => {
		const { events, observer } = harness();
		for (let i = 0; i < 3; i++) {
			observer.observe({
				snapshotInstalled: true,
				connectionGeneration: 1,
				candidates: [candidate("s1", state()), candidate("s2", state())],
			});
		}
		expect(events).toHaveLength(0);
	});

	test("a session that disappears and returns lit emits a fresh edge", () => {
		const { events, observer } = harness();
		observer.observe({
			snapshotInstalled: true,
			connectionGeneration: 1,
			candidates: [candidate("s1", lit)],
		});
		// s1 lit at prime "-> no event; now it leaves the set entirely
		observer.observe({ snapshotInstalled: true, connectionGeneration: 1, candidates: [] });
		// returns lit -> a rising edge again
		observer.observe({
			snapshotInstalled: true,
			connectionGeneration: 1,
			candidates: [candidate("s1", lit)],
		});
		expect(events.map((e) => e.sessionId)).toEqual(["s1"]);
	});

	test("a session going dark then lit again re-emits", () => {
		const { events, observer } = harness();
		observer.observe({
			snapshotInstalled: true,
			connectionGeneration: 1,
			candidates: [candidate("s1", state())],
		});
		observer.observe({
			snapshotInstalled: true,
			connectionGeneration: 1,
			candidates: [candidate("s1", lit)],
		});
		observer.observe({
			snapshotInstalled: true,
			connectionGeneration: 1,
			candidates: [candidate("s1", state())],
		});
		observer.observe({
			snapshotInstalled: true,
			connectionGeneration: 1,
			candidates: [candidate("s1", lit)],
		});
		expect(events).toHaveLength(2);
	});
});
