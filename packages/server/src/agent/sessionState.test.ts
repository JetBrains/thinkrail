import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Message } from "@thinkrail/contracts";
import { deriveSessionState } from "./sessionState";

function entry(id: string, message: Message, parentId: string | null): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: new Date(0).toISOString(),
		message,
	} as SessionEntry;
}

const user = (id = "u1", parentId: string | null = null): SessionEntry =>
	entry(
		id,
		{ role: "user", content: [{ type: "text", text: "work" }], timestamp: 1 } as Message,
		parentId,
	);

const assistant = (
	id: string,
	stopReason: "stop" | "error" | "length" | "aborted" | "toolUse",
	parentId = "u1",
): SessionEntry =>
	entry(
		id,
		{ role: "assistant", content: [], stopReason, timestamp: 2 } as unknown as Message,
		parentId,
	);

function inputs(overrides: Partial<Parameters<typeof deriveSessionState>[0]> = {}) {
	return {
		entries: [user(), assistant("a1", "stop")],
		isStreaming: false,
		pendingMessageCount: 0,
		lastSettlement: undefined,
		lifecycleCompletion: undefined,
		liveQuestion: null,
		pendingDialogId: null,
		handledCompletionId: undefined,
		cancelledRunId: undefined,
		...overrides,
	};
}

describe("deriveSessionState", () => {
	test("a live question outranks running while retaining execution and queue facts", () => {
		expect(
			deriveSessionState(
				inputs({
					isStreaming: true,
					pendingMessageCount: 2,
					liveQuestion: { interactionId: "q1", needsInput: true },
				}),
			),
		).toEqual({
			execution: "running",
			runId: "u1",
			needsInput: { interactionId: "question:q1", kind: "question" },
			completion: null,
			completionUnread: false,
			queuedCount: 2,
		});
	});

	test("an accepted live answer suppresses transcript fallback", () => {
		const ask = entry(
			"a-ask",
			{
				role: "assistant",
				stopReason: "toolUse",
				timestamp: 2,
				content: [
					{
						type: "toolCall",
						id: "q1",
						name: "ask_user_question",
						arguments: { questions: [] },
					},
				],
			} as unknown as Message,
			"u1",
		);
		const state = deriveSessionState(
			inputs({
				entries: [user(), ask],
				isStreaming: true,
				liveQuestion: { interactionId: "q1", needsInput: false },
			}),
		);
		expect(state.needsInput).toBeNull();
		expect(state.execution).toBe("running");
	});

	test("a restart transcript reconstructs an unanswered question without a live registry", () => {
		const ask = entry(
			"a-ask",
			{
				role: "assistant",
				stopReason: "toolUse",
				timestamp: 2,
				content: [
					{
						type: "toolCall",
						id: "q1",
						name: "ask_user_question",
						arguments: { questions: [] },
					},
				],
			} as unknown as Message,
			"u1",
		);
		expect(deriveSessionState(inputs({ entries: [user(), ask] })).needsInput).toEqual({
			interactionId: "question:q1",
			kind: "question",
		});
	});

	test("completion outcomes stay explicit and exact receipts clear only the matching result", () => {
		for (const [stopReason, expected] of [
			["stop", { completionId: "completion:a1", outcome: "succeeded" }],
			["error", { completionId: "completion:a1", outcome: "failed", failure: "error" }],
			["length", { completionId: "completion:a1", outcome: "failed", failure: "length" }],
		] as const) {
			const state = deriveSessionState(inputs({ entries: [user(), assistant("a1", stopReason)] }));
			expect(state.completion).toEqual(expected);
			expect(state.completionUnread).toBe(true);
			expect(
				deriveSessionState(
					inputs({
						entries: [user(), assistant("a1", stopReason)],
						handledCompletionId: "completion:a1",
					}),
				).completionUnread,
			).toBe(false);
		}
	});

	test("explicit Stop is cancelled and quiet; an otherwise unfinished run is interrupted", () => {
		const interrupted = deriveSessionState(
			inputs({ entries: [user()], lastSettlement: undefined }),
		);
		expect(interrupted.completion).toEqual({
			completionId: "interrupted:u1",
			outcome: "interrupted",
		});
		expect(interrupted.completionUnread).toBe(true);

		const cancelled = deriveSessionState(
			inputs({ entries: [user(), assistant("a1", "aborted")], cancelledRunId: "u1" }),
		);
		expect(cancelled.completion).toEqual({
			completionId: "completion:a1",
			outcome: "cancelled",
		});
		expect(cancelled.completionUnread).toBe(false);
	});

	test("reconstruction reads the complete active branch instead of capping oversized transcripts", () => {
		const filler = Array.from(
			{ length: 20_000 },
			(_, index): SessionEntry => ({
				type: "custom_message",
				id: `filler-${index}`,
				parentId: index === 0 ? null : `filler-${index - 1}`,
				timestamp: new Date().toISOString(),
				customType: "filler",
				content: "x",
				display: false,
			}),
		);
		const state = deriveSessionState(
			inputs({
				entries: [...filler, user("oversized-user"), assistant("oversized-result", "stop")],
			}),
		);
		expect(state.runId).toBe("oversized-user");
		expect(state.completion).toEqual({
			completionId: "completion:oversized-result",
			outcome: "succeeded",
		});
	});

	test("a new or empty session is idle without inventing a completion", () => {
		expect(deriveSessionState(inputs({ entries: [] }))).toEqual({
			execution: "idle",
			runId: null,
			needsInput: null,
			completion: null,
			completionUnread: false,
			queuedCount: 0,
		});
	});
});
