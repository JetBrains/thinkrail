import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Message } from "@thinkrail/contracts";
import type { InteractiveTools } from "../extensions";
import { deriveSessionState } from "./sessionState";

const INTERACTIVE: InteractiveTools = new Map([["ask_user_question", {}]]);

const QUESTION_ARGS = {
	questions: [
		{
			question: "Which runtime?",
			header: "Runtime",
			options: [
				{ label: "Bun", description: "fast" },
				{ label: "Node", description: "compatible" },
			],
		},
	],
};

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
		backgroundWorkActive: false,
		lastSettlement: undefined,
		lifecycleCompletion: undefined,
		liveInteraction: null,
		liveRegistry: false,
		interactiveTools: INTERACTIVE,
		pendingDialog: null,
		handledCompletionId: undefined,
		cancelledRunId: undefined,
		...overrides,
	};
}

describe("deriveSessionState", () => {
	test("a live interaction outranks running while retaining execution and queue facts", () => {
		expect(
			deriveSessionState(
				inputs({
					isStreaming: true,
					pendingMessageCount: 2,
					liveInteraction: { toolCallId: "q1", needsInput: true },
				}),
			),
		).toEqual({
			execution: "running",
			runId: "u1",
			needsInput: { interactionId: "tool:q1", kind: "tool-response", toolCallId: "q1" },
			completion: null,
			completionUnread: false,
			queuedCount: 2,
			backgroundWork: false,
		});
	});

	test("a pending extension dialog carries the exact replayable request", () => {
		const request = {
			id: "dialog-1",
			sessionId: "session-1",
			kind: "confirm" as const,
			title: "Continue?",
			message: "Confirm the operation.",
		};
		const state = deriveSessionState(
			inputs({ entries: [user()], isStreaming: true, pendingDialog: request }),
		);
		expect(state.needsInput).toEqual({
			interactionId: "dialog:dialog-1",
			kind: "dialog",
			request,
		});
	});

	test("an accepted live response suppresses transcript fallback", () => {
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
						arguments: QUESTION_ARGS,
					},
				],
			} as unknown as Message,
			"u1",
		);
		const state = deriveSessionState(
			inputs({
				entries: [user(), ask],
				isStreaming: true,
				liveInteraction: { toolCallId: "q1", needsInput: false },
			}),
		);
		expect(state.needsInput).toBeNull();
		expect(state.execution).toBe("running");
	});

	test("a restart transcript reconstructs an unanswered interactive call without a live registry", () => {
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
						arguments: QUESTION_ARGS,
					},
				],
			} as unknown as Message,
			"u1",
		);
		expect(deriveSessionState(inputs({ entries: [user(), ask] })).needsInput).toEqual({
			interactionId: "tool:q1",
			kind: "tool-response",
			toolCallId: "q1",
		});
	});

	test("an attached session's transcript awaits only a pending-acked interactive call", () => {
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
						arguments: QUESTION_ARGS,
					},
				],
			} as unknown as Message,
			"u1",
		);
		const ack = entry(
			"r-ack",
			{
				role: "toolResult",
				toolCallId: "q1",
				toolName: "ask_user_question",
				content: [{ type: "text", text: "ack" }],
				details: { kind: "ack" },
				isError: false,
				timestamp: 3,
			} as unknown as Message,
			"a-ask",
		);
		const attached = (entries: SessionEntry[]) =>
			deriveSessionState(inputs({ entries, isStreaming: true, liveRegistry: true })).needsInput;
		expect(attached([user(), ask])).toBeNull();
		expect(attached([user(), ask, ack])).toEqual({
			interactionId: "tool:q1",
			kind: "tool-response",
			toolCallId: "q1",
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

	test("a crash after an unexecuted non-interactive tool call reconstructs as interrupted", () => {
		const danglingToolCall = assistant("tool-leaf", "toolUse");
		if (danglingToolCall.type !== "message" || danglingToolCall.message.role !== "assistant") {
			throw new Error("assistant fixture is malformed");
		}
		danglingToolCall.message.content = [
			{ type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "echo hi" } },
		];
		const state = deriveSessionState(inputs({ entries: [user("tool-user"), danglingToolCall] }));
		expect(state.completion).toEqual({
			completionId: "interrupted:tool-user",
			outcome: "interrupted",
		});
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

	test("background work holds an idle completion unread until it ends, never a blocker", () => {
		const held = deriveSessionState(
			inputs({ backgroundWorkActive: true, lastSettlement: { stopReason: "stop" } }),
		);
		expect(held.execution).toBe("idle");
		expect(held.backgroundWork).toBe(true);
		expect(held.completion).toEqual({ completionId: "completion:a1", outcome: "succeeded" });
		expect(held.completionUnread).toBe(false);

		const released = deriveSessionState(inputs({ lastSettlement: { stopReason: "stop" } }));
		expect(released.completionUnread).toBe(true);
		expect(released.backgroundWork).toBe(false);

		const blocked = deriveSessionState(
			inputs({
				backgroundWorkActive: true,
				liveInteraction: { toolCallId: "q1", needsInput: true },
			}),
		);
		expect(blocked.needsInput).toEqual({
			interactionId: "tool:q1",
			kind: "tool-response",
			toolCallId: "q1",
		});
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
			backgroundWork: false,
		});
	});
});
