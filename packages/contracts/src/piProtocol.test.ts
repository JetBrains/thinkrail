import { describe, expect, test } from "bun:test";
import {
	assistantToolCallsAreExecutable,
	type ChatState,
	chatState,
	type SessionState,
} from "./piProtocol";

describe("assistantToolCallsAreExecutable", () => {
	test("rejects every Pi terminal that cannot execute tool calls", () => {
		for (const stopReason of ["error", "aborted", "length"]) {
			expect(assistantToolCallsAreExecutable(stopReason)).toBe(false);
		}
	});

	test("allows executable and in-flight assistant states", () => {
		for (const stopReason of [undefined, "toolUse", "stop"]) {
			expect(assistantToolCallsAreExecutable(stopReason)).toBe(true);
		}
	});
});

describe("chatState", () => {
	const state = (patch: Partial<SessionState>): SessionState => ({
		execution: "idle",
		runId: null,
		needsInput: null,
		completion: null,
		completionUnread: false,
		queuedCount: 0,
		backgroundWork: false,
		...patch,
	});
	const toolWait = { interactionId: "i1", kind: "tool-response", toolCallId: "t1" } as const;
	const failed = { completionId: "c", outcome: "failed", failure: "error" } as const;

	test("maps every session state to one chat state, needs-you first and working before outcome", () => {
		const table: [SessionState | undefined, ChatState][] = [
			[undefined, "idle"],
			[state({}), "idle"],
			[state({ execution: "running" }), "working"],
			[state({ backgroundWork: true }), "working"],
			[state({ execution: "running", needsInput: toolWait }), "needs_you"],
			[state({ backgroundWork: true, needsInput: toolWait, completion: failed }), "needs_you"],
			[state({ execution: "running", completion: failed }), "working"],
			[state({ backgroundWork: true, completion: failed }), "working"],
			[state({ completion: { completionId: "c", outcome: "succeeded" } }), "finished"],
			[state({ completion: failed }), "failed"],
			[
				state({ completion: { completionId: "c", outcome: "failed", failure: "length" } }),
				"failed",
			],
			[state({ completion: { completionId: "c", outcome: "interrupted" } }), "interrupted"],
			[state({ completion: { completionId: "c", outcome: "cancelled" } }), "interrupted"],
		];
		for (const [input, expected] of table) expect(chatState(input)).toBe(expected);
	});

	test("ignores the unread receipt, which callers combine explicitly", () => {
		expect(chatState(state({ completion: failed, completionUnread: true }))).toBe("failed");
		expect(
			chatState(
				state({ completion: { completionId: "c", outcome: "succeeded" }, completionUnread: true }),
			),
		).toBe("finished");
	});
});
