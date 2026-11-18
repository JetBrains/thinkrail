import { expect, test } from "bun:test";
import type { ArtifactTool } from "@thinkrail/extension-api/server";
import { createArtifactEventMapper } from "./artifactEvents";

const tools = new Map<string, ArtifactTool>([
	[
		"show",
		{
			presented: (args) =>
				typeof args === "object" && args !== null && "path" in args && typeof args.path === "string"
					? [args.path]
					: [],
			picked: (_args, details) =>
				typeof details === "object" && details !== null && "chosen" in details
					? [String(details.chosen)]
					: [],
		},
	],
	[
		"broken",
		{
			presented: () => {
				throw new Error("boom");
			},
		},
	],
]);

function mapper() {
	return createArtifactEventMapper(() => tools);
}

test("a declared tool's paths travel from its start to a successful end", () => {
	const map = mapper();
	map("s1", {
		type: "tool_execution_start",
		toolCallId: "c1",
		toolName: "show",
		args: { path: "a.html" },
	});
	expect(
		map("s1", {
			type: "tool_execution_end",
			toolCallId: "c1",
			toolName: "show",
			result: { content: [], details: { chosen: "b.html" } },
			isError: false,
		}),
	).toEqual({
		type: "tool_execution_end",
		toolCallId: "c1",
		toolName: "show",
		presented: ["a.html"],
		picked: ["b.html"],
	});
});

test("a failed call, an undeclared tool or a throwing declaration names no paths", () => {
	const map = mapper();
	map("s1", {
		type: "tool_execution_start",
		toolCallId: "c2",
		toolName: "show",
		args: { path: "a.html" },
	});
	expect(
		map("s1", {
			type: "tool_execution_end",
			toolCallId: "c2",
			toolName: "show",
			result: { content: [], details: { chosen: "b.html" } },
			isError: true,
		}),
	).toEqual({ type: "tool_execution_end", toolCallId: "c2", toolName: "show" });
	expect(
		map("s1", {
			type: "tool_execution_end",
			toolCallId: "c3",
			toolName: "bash",
			result: {},
			isError: false,
		}),
	).toEqual({ type: "tool_execution_end", toolCallId: "c3", toolName: "bash" });
	expect(
		map("s1", {
			type: "tool_execution_end",
			toolCallId: "c4",
			toolName: "broken",
			result: {},
			isError: false,
		}),
	).toEqual({ type: "tool_execution_end", toolCallId: "c4", toolName: "broken" });
});

test("an assistant message hands its text over and a message that opens a chat round opens one here; other events are not artifacts' business", () => {
	const map = mapper();
	expect(
		map("s1", {
			type: "message_end",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hmm" },
					{ type: "text", text: "See `a.md`" },
					{ type: "text", text: "and b.md" },
				],
			},
		} as never),
	).toEqual({ type: "assistant_message", text: "See `a.md`\nand b.md" });
	expect(
		map("s1", {
			type: "message_end",
			message: { role: "assistant", content: [{ type: "toolCall", id: "c", name: "bash" }] },
		} as never),
	).toEqual({ type: "assistant_message", text: "" });
	expect(
		map("s1", {
			type: "message_end",
			message: { role: "user", content: "hi", timestamp: 1 },
		} as never),
	).toEqual({ type: "round_start", at: 1 });
	expect(
		map("s1", { type: "message_end", message: { role: "toolResult", content: [] } } as never),
	).toBeNull();
	expect(
		map("s1", {
			type: "message_end",
			message: {
				role: "custom",
				customType: "todo-review-fix",
				content: "fix",
				display: true,
				details: { itemId: "t_1", itemTitle: "Fix", comments: [] },
				timestamp: 5,
			},
		} as never),
	).toEqual({ type: "round_start", at: 5 });
	expect(
		map("s1", {
			type: "message_end",
			message: { role: "user", content: "[thinkrail:todo-nudge] open items", timestamp: 6 },
		} as never),
	).toBeNull();
	expect(map("s1", { type: "agent_start" })).toEqual({ type: "agent_start" });
	expect(map("s1", { type: "agent_settled", terminal: null })).toEqual({ type: "agent_settled" });
	expect(map("s1", { type: "turn_start" })).toBeNull();
});

test("two chats reusing a tool call id keep their own arguments", () => {
	const map = mapper();
	map("s1", {
		type: "tool_execution_start",
		toolCallId: "call_0",
		toolName: "show",
		args: { path: "a.html" },
	});
	map("s2", {
		type: "tool_execution_start",
		toolCallId: "call_0",
		toolName: "show",
		args: { path: "b.html" },
	});
	const end = (sessionId: string) =>
		map(sessionId, {
			type: "tool_execution_end",
			toolCallId: "call_0",
			toolName: "show",
			result: { content: [], details: {} },
			isError: false,
		});
	expect(end("s1")).toMatchObject({ presented: ["a.html"] });
	expect(end("s2")).toMatchObject({ presented: ["b.html"] });
});
