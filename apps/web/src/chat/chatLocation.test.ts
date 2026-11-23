import { describe, expect, test } from "bun:test";
import type { TranscriptMessage } from "@thinkrail/contracts";
import { EMPTY_RUNTIME, reduceSessionEvent, type SessionRuntime } from "@/store";
import { locateChatRow } from "./chatLocation";
import { messagesToRuntime } from "./hydrate";
import { deriveRows, rowIndexForToolCall } from "./rows";
import { registerToolRenderer } from "./toolRegistry";
import type { ChatTurn, ToolResultState } from "./types";

registerToolRenderer("location-primary", () => null, { prominence: "primary" });

function user(id: string, text: string): ChatTurn {
	return { kind: "user", id, message: { role: "user", content: text, timestamp: 0 } } as ChatTurn;
}

function assistant(id: string, text: string, calls: { id: string; name: string }[]): ChatTurn {
	return {
		kind: "assistant",
		id,
		streaming: false,
		message: {
			role: "assistant",
			content: [
				{ type: "text", text },
				...calls.map((call) => ({ type: "toolCall", id: call.id, name: call.name, arguments: {} })),
			],
			stopReason: "toolUse",
			timestamp: 0,
		},
	} as unknown as ChatTurn;
}

const turns: ChatTurn[] = [
	user("u1", "fix the flaky test"),
	assistant("a1", "Running the routine checks.", [
		{ id: "call-routine", name: "bash" },
		{ id: "call-primary", name: "location-primary" },
	]),
	user("u2", "thanks"),
];
const results: Record<string, ToolResultState> = {
	"call-routine": { status: "error", raw: { content: [] } },
	"call-primary": { status: "done", raw: { content: [] } },
};
const rows = deriveRows(turns, results, false);
const map = ["u1", "a1", null, null, "u2"];

describe("locateChatRow", () => {
	test("lands on a primary tool's own row and on the activity row grouping a routine one", () => {
		const primary = locateChatRow(
			{ messageIndex: 1, anchorText: "Running", toolCallId: "call-primary" },
			rows,
			turns,
			map,
		);
		expect(rows[primary.index]).toMatchObject({ kind: "tool", toolCallId: "call-primary" });
		expect(primary.nearest).toBe(false);
		const routine = locateChatRow(
			{ messageIndex: 1, anchorText: "Running", toolCallId: "call-routine" },
			rows,
			turns,
			map,
		);
		expect(rows[routine.index]?.kind).toBe("activity");
		expect(routine.index).toBe(rowIndexForToolCall(rows, "call-routine"));
	});

	test("falls back to the message when the chat does not show the tool call, and says so", () => {
		const located = locateChatRow(
			{ messageIndex: 1, anchorText: "Running", toolCallId: "call-gone" },
			rows,
			turns,
			map,
		);
		expect(rows[located.index]?.id.startsWith("a1:text:")).toBe(true);
		expect(located.nearest).toBe(true);
	});

	test("resolves a message by display index, then by anchor text, flagging an approximate anchor", () => {
		expect(
			rows[locateChatRow({ messageIndex: 4, anchorText: "thanks" }, rows, turns, map).index]?.id,
		).toBe("u2");
		const byText = locateChatRow({ messageIndex: 0, anchorText: "thanks" }, rows, turns, undefined);
		expect(rows[byText.index]?.id).toBe("u2");
		expect(byText.nearest).toBe(false);
		const approximate = locateChatRow(
			{ messageIndex: 0, anchorText: "fix the", approximate: true },
			rows,
			turns,
			map,
		);
		expect(rows[approximate.index]?.id).toBe("u1");
		expect(approximate.nearest).toBe(true);
		expect(locateChatRow({ messageIndex: 9, anchorText: "nowhere" }, rows, turns, map).index).toBe(
			-1,
		);
	});
});

describe("locateChatRow for a message without text", () => {
	const transcript = [
		{ role: "user", content: "lint it", timestamp: 1 },
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "call-lint", name: "bash", arguments: {} },
				{ type: "toolCall", id: "call-show", name: "location-primary", arguments: {} },
			],
			stopReason: "toolUse",
			timestamp: 2,
		},
		{ role: "toolResult", toolCallId: "call-lint", toolName: "bash", content: [], timestamp: 3 },
		{
			role: "toolResult",
			toolCallId: "call-show",
			toolName: "location-primary",
			content: [],
			timestamp: 4,
		},
		{
			role: "assistant",
			content: [{ type: "text", text: "Lint is clean." }],
			stopReason: "stop",
			timestamp: 5,
		},
		{ role: "user", content: "thanks", timestamp: 6 },
	] as unknown as TranscriptMessage[];
	const hydrated = messagesToRuntime(transcript, null, { idScope: "chat" });
	const live = transcript.reduce<SessionRuntime>((runtime, message) => {
		if (message.role !== "toolResult") {
			const started = reduceSessionEvent(runtime, { type: "message_start", message });
			return reduceSessionEvent(started, { type: "message_end", message });
		}
		return reduceSessionEvent(runtime, {
			type: "tool_execution_end",
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			result: { content: message.content },
			isError: false,
		});
	}, EMPTY_RUNTIME);
	const runtimes = [
		{
			name: "hydrated",
			turns: hydrated.turns,
			results: hydrated.toolResults,
			map: hydrated.turnIdByMessageIndex,
		},
		{ name: "live", turns: live.turns, results: live.toolResults, map: live.turnIdByMessageIndex },
	];

	test("the live reducer carries no message map and the hydrated one maps tool results to none", () => {
		expect(live.turnIdByMessageIndex).toBeUndefined();
		expect(hydrated.turnIdByMessageIndex.slice(2, 4)).toEqual([null, null]);
	});

	test.each(runtimes)(
		"$name: a tool result lands on its call by id, and nowhere without one",
		({ turns: quiet, results, map }) => {
			const quietRows = deriveRows(quiet, results, false);
			const located = locateChatRow(
				{ messageIndex: 3, anchorText: "", toolCallId: "call-show" },
				quietRows,
				quiet,
				map,
			);
			expect(quietRows[located.index]).toMatchObject({ kind: "tool", toolCallId: "call-show" });
			expect(located.nearest).toBe(false);
			for (const anchorText of ["", "  "]) {
				expect(locateChatRow({ messageIndex: 2, anchorText }, quietRows, quiet, map).index).toBe(
					-1,
				);
			}
		},
	);

	test("hydrated: a tool-call-only message lands on its first tool call, flagged nearest", () => {
		const quietRows = deriveRows(hydrated.turns, hydrated.toolResults, false);
		const located = locateChatRow(
			{ messageIndex: 1, anchorText: "" },
			quietRows,
			hydrated.turns,
			hydrated.turnIdByMessageIndex,
		);
		expect(located.index).not.toBe(-1);
		expect(located.index).toBe(rowIndexForToolCall(quietRows, "call-lint"));
		expect(located.nearest).toBe(true);
	});

	test("live: a tool-call-only message without its call id is not matched to the newest turn", () => {
		const quietRows = deriveRows(live.turns, live.toolResults, false);
		expect(
			locateChatRow({ messageIndex: 1, anchorText: "" }, quietRows, live.turns, undefined).index,
		).toBe(-1);
		const byCall = locateChatRow(
			{ messageIndex: 1, anchorText: "", toolCallId: "call-lint" },
			quietRows,
			live.turns,
			undefined,
		);
		expect(byCall.index).toBe(rowIndexForToolCall(quietRows, "call-lint"));
		expect(byCall.nearest).toBe(false);
	});
});
