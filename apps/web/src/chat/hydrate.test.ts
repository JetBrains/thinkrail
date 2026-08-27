import { expect, test } from "bun:test";
import type { TranscriptMessage } from "@thinkrail/contracts";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "@thinkrail/contracts";
import { messagesToRuntime } from "./hydrate";

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

test("an assistant turn that ended at length hydrates a visible truncation failure", () => {
	const { turns } = messagesToRuntime([
		{ role: "user", content: "hi", timestamp: 1 },
		{ role: "assistant", content: [], stopReason: "length" },
	] as unknown as Message[]);

	expect(turns.map((turn) => turn.kind)).toEqual(["user", "assistant", "error"]);
	const error = turns.find((turn) => turn.kind === "error");
	expect(error?.kind === "error" && error.text.toLowerCase()).toContain("truncated");
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

test("an ask-user-answers custom message indexes into askAnswers and never becomes a turn", () => {
	const result = {
		answers: [{ questionIndex: 0, question: "Q?", kind: "option", answer: "A" }],
		cancelled: false,
	};
	const { turns, askAnswers } = messagesToRuntime([
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "ask3", name: "ask_user_question", arguments: {} }],
		},
		{
			role: "custom",
			customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
			content: "User has answered your questions: …",
			display: true,
			details: { toolCallId: "ask3", result },
			timestamp: 2,
		},
	] as unknown as Message[]);
	expect(turns).toHaveLength(1);
	expect(askAnswers.ask3).toEqual(result as never);
});

test("an answers message with malformed details is ignored — the guard validates shape, not just tag", () => {
	const { askAnswers } = messagesToRuntime([
		{
			role: "custom",
			customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
			content: "looks right, isn't",
			display: true,
			timestamp: 1,
		},
		{
			role: "custom",
			customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
			content: "still not right",
			display: true,
			details: { toolCallId: 42, result: { answers: "nope", cancelled: "nope" } },
			timestamp: 2,
		},
	] as unknown as Message[]);
	expect(Object.keys(askAnswers)).toHaveLength(0);
});

test("unknown custom messages are ignored entirely", () => {
	const { turns, askAnswers } = messagesToRuntime([
		{
			role: "custom",
			customType: "someone-elses-extension",
			content: "hello",
			display: true,
			timestamp: 1,
		},
	] as unknown as Message[]);
	expect(turns).toHaveLength(0);
	expect(Object.keys(askAnswers)).toHaveLength(0);
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
