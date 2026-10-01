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

	expect(JSON.stringify(projectSessionEvent(source, null))).toBe(
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

	expect(projectSessionEvent(source, null)).toEqual({
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

	expect(projectSessionEvent(source, null)).toEqual({
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
	);
	expect(projected.type === "tool_execution_end" && projected.result).toBe(result);
});
