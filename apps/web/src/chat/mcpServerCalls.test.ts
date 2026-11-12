import { expect, test } from "bun:test";
import type { AssistantMessage } from "@thinkrail/contracts";
import { mcpServerCalls } from "./mcpServerCalls";
import type { ChatTurn, ToolResultState } from "./types";

type Call = { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

function assistant(
	id: string,
	calls: Call[],
	timestamp: number,
	stopReason: AssistantMessage["stopReason"] = "toolUse",
): ChatTurn {
	return {
		kind: "assistant",
		id,
		streaming: false,
		message: { role: "assistant", content: calls, stopReason, timestamp },
	} as unknown as ChatTurn;
}

const call = (id: string, name: string, args: Record<string, unknown> = {}): Call => ({
	type: "toolCall",
	id,
	name,
	arguments: args,
});

const done = (details: Record<string, unknown>): ToolResultState => ({
	status: "done",
	raw: { content: [{ type: "text", text: "ok" }], details },
});

test("lists one server's tool and resource calls from this chat, newest first", () => {
	const turns: ChatTurn[] = [
		{ kind: "user", id: "u1", message: { role: "user", content: "hi", timestamp: 1 } } as ChatTurn,
		assistant(
			"a1",
			[
				call("c1", "mcp__github__search_issues", { q: "bug" }),
				call("c2", "mcp__docs__lookup"),
				call("c3", "bash", { command: "ls" }),
			],
			100,
		),
		assistant(
			"a2",
			[
				call("c4", "read_mcp_resource", { server: "github", uri: "repo://x" }),
				call("c5", "list_mcp_resources"),
				call("c6", "mcp__gh_hash__get_pull"),
			],
			200,
		),
	];
	const results = {
		c1: done({ server: "github", tool: "search_issues" }),
		c5: done({ server: "", tool: "list_mcp_resources" }),
		c6: done({ server: "github", tool: "get_pull" }),
	};
	const calls = mcpServerCalls(turns, results, "github");
	expect(calls.map((item) => [item.toolCallId, item.tool, item.at])).toEqual([
		["c6", "get_pull", 200],
		["c4", "read_mcp_resource", 200],
		["c1", "search_issues", 100],
	]);
	expect(calls[2]?.result?.status).toBe("done");
	expect(calls[1]?.result).toBeUndefined();
	expect(mcpServerCalls(turns, results, "docs").map((item) => item.tool)).toEqual(["lookup"]);
	expect(mcpServerCalls(turns, results, "absent")).toEqual([]);
});

test("a call the turn can no longer execute is marked dead", () => {
	const turns = [assistant("a1", [call("c1", "mcp__github__search")], 5, "aborted")];
	expect(mcpServerCalls(turns, {}, "github")[0]?.dead).toBe(true);
});
