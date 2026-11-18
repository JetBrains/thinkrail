import { expect, test } from "bun:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { projectSessionEvent } from "./sessionEventProjection";

test("compaction_end serializes only the versioned token-count allowlist", () => {
	const source: Extract<AgentSessionEvent, { type: "compaction_end" }> = {
		type: "compaction_end",
		reason: "threshold",
		result: {
			summary: "private conversation summary",
			firstKeptEntryId: "entry-42",
			tokensBefore: 148_000,
			estimatedTokensAfter: 12_000,
			details: { extensionSecret: "not-for-the-wire" },
		},
		aborted: false,
		willRetry: false,
	};

	expect(JSON.stringify(projectSessionEvent(source, null, "session-1"))).toBe(
		JSON.stringify({
			type: "compaction_end",
			reason: "threshold",
			result: { tokensBefore: 148_000, estimatedTokensAfter: 12_000 },
			aborted: false,
			willRetry: false,
		}),
	);
});

test("tool_execution_end drops the programmatic structuredContent and keeps the rest", () => {
	const source: Extract<AgentSessionEvent, { type: "tool_execution_end" }> = {
		type: "tool_execution_end",
		toolCallId: "call-1",
		toolName: "bash",
		result: {
			content: [{ type: "text", text: "ok" }],
			details: { truncation: undefined },
			structuredContent: { output: "x".repeat(1024), truncated: false, exit_code: 0 },
		},
		isError: false,
	};

	expect(projectSessionEvent(source, null, "session-1")).toEqual({
		type: "tool_execution_end",
		toolCallId: "call-1",
		toolName: "bash",
		result: { content: [{ type: "text", text: "ok" }], details: { truncation: undefined } },
		isError: false,
	});
});

test("tool_execution_update drops structuredContent from the partial result", () => {
	const source: Extract<AgentSessionEvent, { type: "tool_execution_update" }> = {
		type: "tool_execution_update",
		toolCallId: "call-2",
		toolName: "stream_tool",
		args: { q: 1 },
		partialResult: {
			content: [{ type: "text", text: "partial" }],
			details: {},
			structuredContent: { rows: ["large"] },
		},
	};

	expect(projectSessionEvent(source, null, "session-1")).toEqual({
		type: "tool_execution_update",
		toolCallId: "call-2",
		toolName: "stream_tool",
		args: { q: 1 },
		partialResult: { content: [{ type: "text", text: "partial" }], details: {} },
	});
});

test("tool results without structuredContent pass through by identity", () => {
	const result = { content: [{ type: "text", text: "ok" }], details: {} };
	const projected = projectSessionEvent(
		{ type: "tool_execution_end", toolCallId: "call-3", toolName: "read", result, isError: false },
		null,
		"session-1",
	);
	expect(projected.type === "tool_execution_end" && projected.result).toBe(result);
});

test("entry_appended carries only the appended entry's type", () => {
	const projected = projectSessionEvent(
		{
			type: "entry_appended",
			entry: {
				type: "custom",
				id: "entry-1",
				parentId: null,
				timestamp: "2026-10-24T00:00:00.000Z",
				customType: "extension-state",
				data: { secret: "not-for-the-wire" },
			},
		},
		null,
		"session-1",
	);
	expect(projected).toEqual({ type: "entry_appended", entryType: "custom" });
});

test("every image an event carries leaves as a reference, while pi's own objects keep their bytes", () => {
	const image = { type: "image" as const, data: "iVBORw0KGgoAAAANSUhEUg==", mimeType: "image/png" };
	const toolResult = {
		role: "toolResult" as const,
		toolCallId: "call-9",
		toolName: "read",
		content: [{ type: "text" as const, text: "shot.png" }, image],
		isError: false,
		timestamp: 1,
	};
	const sources: AgentSessionEvent[] = [
		{
			type: "tool_execution_end",
			toolCallId: "call-9",
			toolName: "read",
			result: { content: [image], details: {} },
			isError: false,
		},
		{ type: "message_start", message: toolResult },
		{ type: "message_end", message: toolResult },
		{
			type: "turn_end",
			message: {
				role: "assistant",
				content: [],
				api: "x",
				provider: "x",
				model: "x",
				usage: {} as never,
				stopReason: "toolUse",
				timestamp: 1,
			},
			toolResults: [toolResult],
		},
		{ type: "agent_end", messages: [toolResult], willRetry: false },
	];
	for (const source of sources) {
		const wire = JSON.stringify(projectSessionEvent(source, null, "session-1"));
		expect(wire).not.toContain(image.data);
		expect(wire).toContain("/images/session-1/");
	}
	expect(toolResult.content[1]).toBe(image);
	expect(image.data).toBe("iVBORw0KGgoAAAANSUhEUg==");
});
