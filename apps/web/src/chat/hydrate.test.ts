import { expect, test } from "bun:test";
import type { TranscriptMessage } from "@thinkrail/contracts";
import { TOOL_RESPONSE_CUSTOM_TYPE } from "@thinkrail/contracts";
import { messagesToRuntime } from "./hydrate";
import { deriveRows } from "./rows";
import { readRunDetails } from "./tools/subagent/runDetails";

type Message = TranscriptMessage;

const messages = [
	{ role: "user", content: "do it", timestamp: 1 },
	{ role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "bash", arguments: {} }] },
	{
		role: "toolResult",
		toolCallId: "tc1",
		toolName: "bash",
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp: 3,
	},
	{ role: "assistant", content: [{ type: "text", text: "finished" }] },
] as unknown as Message[];

test("messagesToRuntime folds a transcript into ordered turns + a toolResults map", () => {
	const { turns, toolResults } = messagesToRuntime(messages);

	expect(turns.map((t) => t.kind)).toEqual(["user", "assistant", "assistant"]);
	expect(turns.every((t) => typeof t.id === "string" && t.id.length > 0)).toBe(true);
	expect(
		turns
			.filter((t) => t.kind === "assistant")
			.every((t) => t.kind === "assistant" && !t.streaming),
	).toBe(true);

	expect(toolResults.tc1?.status).toBe("done");
});

test("a scoped append-only hydration preserves existing turn ids", () => {
	const first = messagesToRuntime(messages, undefined, { idScope: "subagent:child-1" });
	const second = messagesToRuntime(
		[
			...messages,
			{
				role: "assistant",
				content: [{ type: "text", text: "one more thing" }],
				timestamp: 4,
			},
		] as unknown as Message[],
		undefined,
		{ idScope: "subagent:child-1" },
	);

	expect(second.turns.slice(0, first.turns.length).map((turn) => turn.id)).toEqual(
		first.turns.map((turn) => turn.id),
	);
	expect(new Set(second.turns.map((turn) => turn.id)).size).toBe(second.turns.length);
});

test("an assistant turn that ended in a provider error hydrates a following error turn", () => {
	const { turns } = messagesToRuntime([
		{ role: "user", content: "hi", timestamp: 1 },
		{
			role: "assistant",
			content: [],
			stopReason: "error",
			errorMessage: "model 'gpt-5.5' not found",
		},
	] as unknown as Message[]);
	expect(turns.map((t) => t.kind)).toEqual(["user", "assistant", "error"]);
	const err = turns.find((t) => t.kind === "error");
	expect(err?.kind === "error" && err.text).toContain("gpt-5.5");
	expect(err?.kind === "error" ? err.recovery : undefined).toBe("try-again");
});

test("a failed round keeps its error before a later user-stopped result that woke nobody", () => {
	const user = { role: "user", content: "start it", timestamp: 1 } as const;
	const failed = {
		role: "assistant",
		content: [],
		stopReason: "error",
		errorMessage: "provider overloaded",
		timestamp: 2,
	};
	const stopped = {
		role: "custom",
		customType: "background-command-completion",
		content: "Cancelled background command",
		display: true,
		timestamp: 3,
		details: {
			id: "bg-1",
			sessionId: "s",
			name: "e2e",
			status: "stopped",
			startedAt: 1,
			finishedAt: 3,
			exitCode: null,
			output: { text: "", truncated: false },
		},
	};
	const hydrated = messagesToRuntime([user, failed, stopped] as unknown as Message[]);
	expect(hydrated.turns.map((t) => t.kind)).toEqual([
		"user",
		"assistant",
		"error",
		"backgroundCommandCompletion",
	]);
	expect(deriveRows(hydrated.turns, hydrated.toolResults, false).map((r) => r.kind)).toEqual([
		"user",
		"error",
		"divider",
		"backgroundCommandCompletion",
	]);

	const woke = { ...stopped, details: { ...stopped.details, status: "completed", exitCode: 0 } };
	expect(messagesToRuntime([user, failed, woke] as unknown as Message[]).turns.at(-1)?.kind).toBe(
		"error",
	);
});

test("an assistant turn that ended at length hydrates a visible truncation failure", () => {
	const { turns } = messagesToRuntime([
		{ role: "user", content: "hi", timestamp: 1 },
		{ role: "assistant", content: [], stopReason: "length" },
	] as unknown as Message[]);

	expect(turns.map((turn) => turn.kind)).toEqual(["user", "assistant", "error"]);
	const error = turns.find((turn) => turn.kind === "error");
	expect(error?.kind === "error" && error.failure).toBe("truncated");
	expect(error?.kind === "error" ? error.recovery : undefined).toBe("try-again");
});

test("a recovered historical length stop does not become the current chat failure", () => {
	const { turns } = messagesToRuntime([
		{
			role: "assistant",
			content: [{ type: "text", text: "old truncated attempt" }],
			stopReason: "length",
			timestamp: 1000,
		},
		{ role: "user", content: "continue", timestamp: 2000 },
		{
			role: "assistant",
			content: [{ type: "text", text: "finished later" }],
			stopReason: "stop",
			timestamp: 3000,
		},
	] as unknown as Message[]);

	expect(turns.filter((turn) => turn.kind === "error")).toHaveLength(0);
	expect(turns.some((turn) => turn.kind === "error" && turn.recovery)).toBe(false);
});

test("settlement metadata restores a failure Pi removed from a live session's context", () => {
	const { turns } = messagesToRuntime([], { stopReason: "length" });

	expect(turns.map((turn) => turn.kind)).toEqual(["error"]);
});

test("settlement metadata does not duplicate a failure already represented by the transcript", () => {
	const { turns } = messagesToRuntime(
		[
			{
				role: "assistant",
				content: [],
				stopReason: "length",
				timestamp: 2000,
			},
		] as unknown as Message[],
		{ stopReason: "length" },
	);

	expect(turns.map((turn) => turn.kind)).toEqual(["assistant", "error"]);
});

test("an explicit live null suppresses a stale persisted failure while a resumed run is active", () => {
	const { turns } = messagesToRuntime(
		[{ role: "assistant", content: [], stopReason: "length" }] as unknown as Message[],
		null,
	);

	expect(turns.map((turn) => turn.kind)).toEqual(["assistant"]);
});

test("a persisted failed attempt superseded by a successful retry hydrates as one assistant turn", () => {
	const { turns, turnIdByMessageIndex } = messagesToRuntime([
		{ role: "user", content: "hi", timestamp: 1 },
		{
			role: "assistant",
			content: [{ type: "text", text: "partial…" }],
			stopReason: "error",
			errorMessage: "fetch failed",
		},
		{ role: "assistant", content: [{ type: "text", text: "the real reply" }], stopReason: "stop" },
	] as unknown as Message[]);
	expect(turns.map((t) => t.kind)).toEqual(["user", "assistant"]);
	expect(turnIdByMessageIndex).toEqual([turns[0]?.id ?? null, null, turns[1]?.id ?? null]);
});

test("exhausted retries hydrate as the final attempt + its error turn; earlier attempts stay hidden", () => {
	const { turns } = messagesToRuntime([
		{ role: "user", content: "hi", timestamp: 1 },
		{ role: "assistant", content: [], stopReason: "error", errorMessage: "attempt 1" },
		{ role: "assistant", content: [], stopReason: "error", errorMessage: "attempt 2" },
	] as unknown as Message[]);
	expect(turns.map((t) => t.kind)).toEqual(["user", "assistant", "error"]);
	const err = turns.find((t) => t.kind === "error");
	expect(err?.kind === "error" && err.text).toContain("attempt 2");
});

test("turnIdByMessageIndex maps each message's position to its own turn id, null for non-turn messages, and the assistant's id (not the injected error turn's) when the message ended in an error", () => {
	const { turns, turnIdByMessageIndex } = messagesToRuntime([
		{ role: "user", content: "hi", timestamp: 1 },
		{
			role: "toolResult",
			toolCallId: "x",
			toolName: "bash",
			content: [],
			isError: false,
			timestamp: 2,
		},
		{
			role: "custom",
			customType: "someone-elses-extension",
			content: "hello",
			display: true,
			timestamp: 3,
		},
		{ role: "user", content: "again", timestamp: 4 },
		{ role: "assistant", content: [], stopReason: "error", errorMessage: "boom" },
	] as unknown as Message[]);

	expect(turns.map((t) => t.kind)).toEqual(["user", "user", "assistant", "error"]);
	expect(turnIdByMessageIndex).toHaveLength(5);
	expect(turnIdByMessageIndex[0]).toBe(turns[0]?.id);
	expect(turnIdByMessageIndex[1]).toBeNull();
	expect(turnIdByMessageIndex[2]).toBeNull();
	expect(turnIdByMessageIndex[3]).toBe(turns[1]?.id);
	expect(turnIdByMessageIndex[4]).toBe(turns[2]?.id);
	expect(turnIdByMessageIndex[4]).not.toBe(turns[3]?.id);
});

test("a subagent-completion custom message hydrates as its own subagentCompletion turn", () => {
	const details = {
		childSessionId: "child-1",
		roleName: "scout",
		task: "map the repo",
		status: "completed",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.01,
			turns: 3,
			contextTokens: 15,
		},
		durationMs: 4200,
	};
	const { turns, turnIdByMessageIndex } = messagesToRuntime([
		{ role: "user", content: "go", timestamp: 1 },
		{
			role: "custom",
			customType: "subagent-completion",
			content: [{ type: "text", text: 'Subagent "scout" (child-1) completed:\n\nthe report' }],
			display: true,
			details,
			timestamp: 2,
		},
	] as unknown as Message[]);
	expect(turns.map((t) => t.kind)).toEqual(["user", "subagentCompletion"]);
	const turn = turns[1];
	expect(turn?.kind === "subagentCompletion" && turn.details.childSessionId).toBe("child-1");
	expect(turn?.kind === "subagentCompletion" && turn.text).toContain("the report");
	expect(turn?.kind === "subagentCompletion" && turn.timestamp).toBe(2);
	expect(turnIdByMessageIndex[1]).toBe(turns[1]?.id ?? null);
});

test("a todo-review-fix custom message hydrates as its own reviewFix turn", () => {
	const details = {
		itemId: "t_1",
		itemTitle: "Wire the login redirect",
		reviewId: "rev_1",
		note: "Two findings below.",
		comments: [{ id: "c_1", kind: "inline", body: "off-by-one", path: "src/a.ts", startLine: 4 }],
	};
	const { turns, turnIdByMessageIndex } = messagesToRuntime([
		{ role: "user", content: "go", timestamp: 1 },
		{
			role: "custom",
			customType: "todo-review-fix",
			content: [{ type: "text", text: "Address each review comment above." }],
			display: true,
			details,
			timestamp: 2,
		},
	] as unknown as Message[]);
	expect(turns.map((t) => t.kind)).toEqual(["user", "reviewFix"]);
	const turn = turns[1];
	expect(turn?.kind === "reviewFix" && turn.details.itemId).toBe("t_1");
	expect(turn?.kind === "reviewFix" && turn.details.comments[0]?.id).toBe("c_1");
	expect(turn?.kind === "reviewFix" && turn.text).toContain("Address each review comment");
	expect(turnIdByMessageIndex[1]).toBe(turns[1]?.id ?? null);
});

test("a continuation request and a handoff hydrate as their own cards, each with its details", () => {
	const request = { operationId: "op1", projectId: "p1", projectName: "repo" };
	const handoff = {
		operationId: "op1",
		sourceWorkspaceId: "chat-1",
		sourceSessionId: "s-chat",
		summary: "The brief.",
	};
	const { turns, turnIdByMessageIndex } = messagesToRuntime([
		{ role: "user", content: "go", timestamp: 1 },
		{
			role: "custom",
			customType: "continue-in-workspace-request",
			content: "Write the summary.",
			display: true,
			details: request,
			timestamp: 2,
		},
		{
			role: "custom",
			customType: "chat-handoff",
			content: "<handoff>",
			display: true,
			details: handoff,
			timestamp: 3,
		},
		{
			role: "custom",
			customType: "chat-handoff",
			content: "malformed",
			display: true,
			details: { operationId: "op2" },
			timestamp: 4,
		},
	] as unknown as Message[]);
	expect(turns.map((turn) => turn.kind)).toEqual(["user", "continuationRequest", "handoff"]);
	expect(turns[1]?.kind === "continuationRequest" && turns[1].details).toEqual(request);
	expect(turns[2]?.kind === "handoff" && turns[2].details).toEqual(handoff);
	expect(turnIdByMessageIndex[2]).toBe(turns[2]?.id ?? null);
});

test("a failed tool result maps to error status", () => {
	const { toolResults } = messagesToRuntime([
		{
			role: "toolResult",
			toolCallId: "x",
			toolName: "bash",
			content: [],
			isError: true,
			timestamp: 1,
		},
	] as unknown as Message[]);
	expect(toolResults.x?.status).toBe("error");
});

test("a failed Agent result keeps its run details — the transcript stays openable after reload", () => {
	const details = {
		childSessionId: "child-err",
		roleName: "scout",
		task: "doomed task",
		status: "error",
		usage: {
			input: 1,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			turns: 1,
			contextTokens: 1,
		},
		durationMs: 10,
	};
	const { toolResults } = messagesToRuntime([
		{
			role: "toolResult",
			toolCallId: "ag1",
			toolName: "Agent",
			content: [{ type: "text", text: 'Subagent "scout" (child-err) failed: boom' }],
			isError: true,
			details,
			timestamp: 1,
		},
	] as unknown as Message[]);
	expect(toolResults.ag1?.status).toBe("error");
	expect(readRunDetails(toolResults.ag1?.raw)?.childSessionId).toBe("child-err");
});

test("a toolCall with no matching toolResult has no entry — the call renders as still running", () => {
	const { turns, toolResults } = messagesToRuntime([
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "ask1", name: "ask_user_question", arguments: { questions: [] } },
			],
		},
	] as unknown as Message[]);
	expect(turns).toHaveLength(1);
	expect(toolResults.ask1).toBeUndefined();
});

test("a resolved toolResult keeps its structured `details` (a legacy blocking-era ask record)", () => {
	const details = {
		answers: [{ questionIndex: 0, question: "Q?", kind: "option", answer: "A" }],
		cancelled: false,
	};
	const { toolResults } = messagesToRuntime([
		{
			role: "toolResult",
			toolCallId: "ask2",
			toolName: "ask_user_question",
			content: [{ type: "text", text: "User has answered…" }],
			details,
			isError: false,
			timestamp: 1,
		},
	] as unknown as Message[]);
	expect(toolResults.ask2?.status).toBe("done");
	expect((toolResults.ask2?.raw as { details: unknown }).details).toEqual(details);
});

test("a tool-response custom message indexes into toolResponses and never becomes a turn", () => {
	const response = { answers: [{ questionIndex: 0, question: "Q?", kind: "text", answer: "A" }] };
	const { turns, toolResponses } = messagesToRuntime([
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "ask3", name: "ask_user_question", arguments: {} }],
		},
		{
			role: "custom",
			customType: TOOL_RESPONSE_CUSTOM_TYPE,
			content: "User has answered your questions: …",
			display: true,
			details: { toolCallId: "ask3", response },
			timestamp: 2,
		},
	] as unknown as Message[]);
	expect(turns).toHaveLength(1);
	expect(toolResponses.ask3).toEqual(response);
});

test("a legacy ask-user-answers custom message (details.result) indexes into toolResponses too", () => {
	const result = {
		answers: [{ questionIndex: 0, question: "Q?", kind: "option", answer: "A" }],
		cancelled: false,
	};
	const { turns, toolResponses } = messagesToRuntime([
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "ask3", name: "ask_user_question", arguments: {} }],
		},
		{
			role: "custom",
			customType: "ask-user-answers",
			content: "User has answered your questions: …",
			display: true,
			details: { toolCallId: "ask3", result },
			timestamp: 2,
		},
	] as unknown as Message[]);
	expect(turns).toHaveLength(1);
	expect(toolResponses.ask3).toEqual(result);
});

test("a response message with malformed details is ignored — the guard validates the envelope, not just the tag", () => {
	const { toolResponses } = messagesToRuntime([
		{
			role: "custom",
			customType: TOOL_RESPONSE_CUSTOM_TYPE,
			content: "looks right, isn't",
			display: true,
			timestamp: 1,
		},
		{
			role: "custom",
			customType: TOOL_RESPONSE_CUSTOM_TYPE,
			content: "no tool call id",
			display: true,
			details: { toolCallId: 42, response: {} },
			timestamp: 2,
		},
		{
			role: "custom",
			customType: TOOL_RESPONSE_CUSTOM_TYPE,
			content: "no response key",
			display: true,
			details: { toolCallId: "ask4" },
			timestamp: 3,
		},
		{
			role: "custom",
			customType: "ask-user-answers",
			content: "legacy without a result",
			display: true,
			details: { toolCallId: "ask5" },
			timestamp: 4,
		},
	] as unknown as Message[]);
	expect(Object.keys(toolResponses)).toHaveLength(0);
});

test("unknown custom messages are ignored entirely", () => {
	const { turns, toolResponses } = messagesToRuntime([
		{
			role: "custom",
			customType: "someone-elses-extension",
			content: "hello",
			display: true,
			timestamp: 1,
		},
	] as unknown as Message[]);
	expect(turns).toHaveLength(0);
	expect(Object.keys(toolResponses)).toHaveLength(0);
});

test("a compaction summary becomes its own turn without claiming a jump anchor", () => {
	const { turns, turnIdByMessageIndex } = messagesToRuntime([
		{ role: "user", content: "start", timestamp: 1 },
		{ role: "compactionSummary", summary: "## Goal\nship it", tokensBefore: 148_000, timestamp: 2 },
		{ role: "assistant", content: [{ type: "text", text: "carrying on" }] },
	] as unknown as Message[]);

	expect(turns.map((t) => t.kind)).toEqual(["user", "compaction", "assistant"]);
	const compaction = turns[1];
	expect(compaction).toMatchObject({
		kind: "compaction",
		status: "done",
		summary: "## Goal\nship it",
		tokensBefore: 148_000,
	});
	expect(turnIdByMessageIndex).toEqual([turns[0]?.id ?? null, null, turns[2]?.id ?? null]);
});
