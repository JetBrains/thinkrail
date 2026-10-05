import { describe, expect, test } from "bun:test";
import type { SessionState } from "@thinkrail/contracts";
import { type AttentionCandidate, attentionReason, diffAttention, isLit } from "./detectAttention";

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

function candidate(overrides: Partial<AttentionCandidate> = {}): AttentionCandidate {
	return {
		sessionId: "s1",
		workspaceId: "w1",
		worktreeName: "branch",
		state: state(),
		...overrides,
	};
}

describe("isLit / attentionReason", () => {
	test("unlit idle session", () => {
		expect(isLit(state())).toBe(false);
		expect(attentionReason(state())).toBeNull();
	});

	test("needs-input lights up", () => {
		const s = state({ needsInput: { interactionId: "i", kind: "question" } });
		expect(isLit(s)).toBe(true);
		expect(attentionReason(s)).toEqual({ kind: "needs-input" });
	});

	test("unread completion lights up with its outcome", () => {
		const completion = { completionId: "c", outcome: "succeeded" } as const;
		const s = state({ completion, completionUnread: true });
		expect(isLit(s)).toBe(true);
		expect(attentionReason(s)).toEqual({ kind: "completed", completion });
	});

	test("a dialog needs-input also lights up", () => {
		const s = state({
			needsInput: {
				interactionId: "i",
				kind: "dialog",
				request: { kind: "confirm" } as never,
			},
		});
		expect(isLit(s)).toBe(true);
		expect(attentionReason(s)).toEqual({ kind: "needs-input" });
	});

	test("failed completions carry their failure kind", () => {
		const error = { completionId: "c", outcome: "failed", failure: "error" } as const;
		const length = { completionId: "c", outcome: "failed", failure: "length" } as const;
		expect(attentionReason(state({ completion: error, completionUnread: true }))).toEqual({
			kind: "completed",
			completion: error,
		});
		expect(attentionReason(state({ completion: length, completionUnread: true }))).toEqual({
			kind: "completed",
			completion: length,
		});
	});

	test("a read completion (completionUnread false) does not light up", () => {
		const s = state({
			completion: { completionId: "c", outcome: "succeeded" },
			completionUnread: false,
		});
		expect(isLit(s)).toBe(false);
		expect(attentionReason(s)).toBeNull();
	});

	test("needs-input wins over completion when both set", () => {
		const s = state({
			needsInput: { interactionId: "i", kind: "question" },
			completion: { completionId: "c", outcome: "succeeded" },
			completionUnread: true,
		});
		expect(attentionReason(s)).toEqual({ kind: "needs-input" });
	});
});

describe("diffAttention", () => {
	test("rising edge emits an event", () => {
		const litState = state({ needsInput: { interactionId: "i", kind: "question" } });
		const { events, litNow } = diffAttention(new Map(), [candidate({ state: litState })]);
		expect(events).toHaveLength(1);
		expect(events[0]?.sessionId).toBe("s1");
		expect(litNow.get("s1")).toBe(true);
	});

	test("staying lit is not a new edge", () => {
		const litState = state({ needsInput: { interactionId: "i", kind: "question" } });
		const { events } = diffAttention(new Map([["s1", true]]), [candidate({ state: litState })]);
		expect(events).toHaveLength(0);
	});

	test("unlit session produces no event and records false", () => {
		const { events, litNow } = diffAttention(new Map([["s1", true]]), [candidate()]);
		expect(events).toHaveLength(0);
		expect(litNow.get("s1")).toBe(false);
	});

	test("multiple candidates emit only the rising ones", () => {
		const { events } = diffAttention(new Map([["s1", true]]), [
			candidate({
				sessionId: "s1",
				state: state({ needsInput: { interactionId: "i", kind: "question" } }),
			}),
			candidate({
				sessionId: "s2",
				state: state({
					completion: { completionId: "c", outcome: "failed", failure: "error" },
					completionUnread: true,
				}),
			}),
			candidate({ sessionId: "s3", state: state() }),
		]);
		expect(events.map((e) => e.sessionId)).toEqual(["s2"]);
	});

	test("re-lighting after going dark emits again", () => {
		const litState = state({
			completion: { completionId: "c", outcome: "succeeded" },
			completionUnread: true,
		});
		const { events } = diffAttention(new Map([["s1", false]]), [candidate({ state: litState })]);
		expect(events).toHaveLength(1);
	});
});
