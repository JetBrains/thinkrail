import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { McpServerDetailView } from "./McpServerDetail";
import { mcpServerCalls } from "./mcpServerCalls";
import type { ChatTurn } from "./types";

const turns = [
	{
		kind: "assistant",
		id: "a1",
		streaming: false,
		message: {
			role: "assistant",
			stopReason: "toolUse",
			timestamp: Date.UTC(2026, 10, 12, 9, 30),
			content: [
				{ type: "toolCall", id: "c1", name: "mcp__github__search_issues", arguments: { q: "bug" } },
				{ type: "toolCall", id: "c2", name: "mcp__github__get_pull", arguments: { number: 7 } },
				{ type: "toolCall", id: "c3", name: "mcp__docs__lookup", arguments: {} },
			],
		},
	},
] as unknown as ChatTurn[];

const results = {
	c1: { status: "done" as const, raw: { content: [], details: { server: "github", tool: "x" } } },
	c2: { status: "error" as const, raw: { content: [], details: {} } },
};

test("the MCP detail shows pi's last status and this chat's calls to the server, newest first", () => {
	const html = renderToStaticMarkup(
		<McpServerDetailView
			status={{
				name: "github",
				state: "failed",
				detail: "connection refused",
				updatedAt: Date.UTC(2026, 10, 12, 9, 31),
			}}
			calls={mcpServerCalls(turns, results, "github", ["github", "docs"])}
		/>,
	);
	expect(html).toContain('data-testid="resource-mcp-status"');
	expect(html).toContain("Last status · ");
	expect(html).toContain("connection refused");
	expect(html).toMatch(/Calls in this chat<span[^>]*>· 2</);
	const ids = [...html.matchAll(/data-tool-call-id="([^"]+)"/g)].map((match) => match[1]);
	expect(ids).toEqual(["c2", "c1"]);
	expect(html).toMatch(/data-tool-call-id="c2" data-status="error"/);
	expect(html).toMatch(/data-tool-call-id="c1" data-status="done"/);
	expect(html).toContain("number=7");
	expect(html).toContain('aria-expanded="false"');
	expect(html).toContain("Failed");
});

test("a server this chat never called says so and omits an absent status", () => {
	const html = renderToStaticMarkup(
		<McpServerDetailView
			status={undefined}
			calls={mcpServerCalls(turns, results, "linear", ["github", "docs", "linear"])}
		/>,
	);
	expect(html).not.toContain('data-testid="resource-mcp-status"');
	expect(html).toContain("No calls to this server in this chat yet.");
});
