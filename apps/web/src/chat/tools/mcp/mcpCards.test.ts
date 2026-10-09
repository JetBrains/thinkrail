import { describe, expect, it } from "bun:test";
import type { ToolRenderProps, ToolStatus } from "@thinkrail/extension-api/web";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ChatActions, ChatActionsContext } from "../../ChatActions";
import { ToolRendererBody } from "../../ToolRendererBody";
import { DefaultToolRenderer, getToolRenderer, getToolSummary } from "../../toolRegistry";
import "./register";
import { McpFullOutputBody } from "./McpActions";
import { McpJsonTree } from "./McpJsonTree";

const PIXEL =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const RICH_RESULT = {
	content: [
		{ type: "text", text: "rich result" },
		{ type: "image", data: PIXEL, mimeType: "image/png" },
		{ type: "text", text: '[Resource file:///notes/a.md "a.md" (text/markdown)]' },
	],
	details: {
		server: "fixture",
		tool: "rich",
		thinkrail: {
			blocks: [
				{ kind: "text", chars: 11 },
				{ kind: "image", mimeType: "image/png" },
				{
					kind: "resource_link",
					uri: "file:///notes/a.md",
					name: "a.md",
					mimeType: "text/markdown",
				},
			],
			structuredContent: { rows: [{ id: 1, title: "first" }] },
		},
	},
};

const SIGN_IN_TEXT = 'MCP server "linear" requires sign-in. Run /mcp to sign in.';

function actions(overrides: Partial<ChatActions> = {}): ChatActions {
	return {
		answerQuestion: async () => {},
		cancelAutomaticReveal: () => {},
		focusComposer: () => {},
		openSubagentTranscript: () => {},
		revealChatElement: () => {},
		readMcpOutput: async () => ({ available: false, reason: "expired" }),
		openMcpSettings: () => {},
		...overrides,
	};
}

function props(
	toolName: string,
	args: Record<string, unknown>,
	result: unknown,
	status: ToolStatus = "done",
): ToolRenderProps {
	return { toolCallId: `${toolName}-call`, toolName, args, result, status, streaming: false };
}

function render(node: ReactNode, provider: ChatActions | null = actions()): string {
	return renderToStaticMarkup(
		createElement(ChatActionsContext.Provider, { value: provider }, node),
	);
}

function renderTool(rendererProps: ToolRenderProps, provider: ChatActions | null = actions()) {
	return render(
		createElement(ToolRendererBody, { ...rendererProps, imageLabel: "tool output" }),
		provider,
	);
}

describe("registration", () => {
	it("routes every mcp__ tool to the MCP card and the four built-in names exactly", () => {
		const card = getToolRenderer("mcp__fixture__echo");
		expect(card).not.toBe(DefaultToolRenderer);
		expect(getToolRenderer("mcp__other__thing")).toBe(card);
		for (const name of [
			"list_mcp_resources",
			"list_mcp_resource_templates",
			"read_mcp_resource",
			"tool_search",
		]) {
			expect(getToolRenderer(name)).not.toBe(DefaultToolRenderer);
			expect(getToolRenderer(name)).not.toBe(card);
		}
		expect(getToolRenderer("mcp_fixture_echo")).toBe(DefaultToolRenderer);
	});

	it("summarizes each card for collapsed headers", () => {
		expect(
			getToolSummary("mcp__fixture__echo", props("mcp__fixture__echo", { text: "hi" }, null)),
		).toBe('text="hi"');
		expect(getToolSummary("list_mcp_resources", props("list_mcp_resources", {}, null))).toBe(
			"all servers",
		);
		expect(
			getToolSummary(
				"list_mcp_resource_templates",
				props("list_mcp_resource_templates", { server: "docs" }, null),
			),
		).toBe("docs");
		expect(
			getToolSummary(
				"read_mcp_resource",
				props("read_mcp_resource", { server: "docs", uri: "file:///a.md" }, null),
			),
		).toBe("docs · file:///a.md");
		expect(getToolSummary("tool_search", props("tool_search", { query: "notes" }, null))).toBe(
			"notes",
		);
	});
});

describe("MCP card", () => {
	it("renders server / tool, args, text blocks in order and a collapsed JSON tree, leaving images to the shared strip", () => {
		const html = renderTool(
			props("mcp__fixture__rich", { verbose: true, label: "x" }, RICH_RESULT),
		);
		expect(html).toContain('data-server="fixture"');
		expect(html).toContain('data-mcp-tool="rich"');
		expect(html).toMatch(/<dt[^>]*>verbose<\/dt><dd[^>]*>true<\/dd>/);
		expect(html).toContain(
			"rich result\n[Resource file:///notes/a.md &quot;a.md&quot; (text/markdown)]",
		);
		expect(html.match(/<img /g)).toHaveLength(1);
		expect(html.match(/data-testid="tool-result-image-thumbnail"/g)).toHaveLength(1);
		expect(html.indexOf('data-testid="tool-mcp"')).toBeLessThan(
			html.indexOf('data-testid="tool-result-images"'),
		);
		expect(html).toContain('data-testid="mcp-structured-toggle"');
		expect(html).toContain('aria-expanded="false"');
		expect(html).not.toContain('data-testid="mcp-json-tree"');
		expect(html).not.toContain('data-testid="mcp-full-output"');
		expect(html).not.toContain('data-testid="mcp-cli-action"');
	});

	it("draws structured content as a JSON tree that expands small values", () => {
		const html = renderToStaticMarkup(
			createElement(McpJsonTree, {
				id: "tree",
				value: { rows: [{ id: 1, title: "first" }], ok: true, missing: null },
			}),
		);
		expect(html).toContain("rows:");
		expect(html).toContain("[1]");
		expect(html).toContain("title:");
		expect(html).toContain("&quot;first&quot;");
		expect(html).toContain("ok:");
		expect(html).toContain(">true<");
		expect(html).toContain(">null<");
	});

	it("keeps a large tree collapsed below the root and caps long lists", () => {
		const html = renderToStaticMarkup(
			createElement(McpJsonTree, {
				id: "big-tree",
				value: { items: Array.from({ length: 150 }, (_, id) => ({ id })) },
			}),
		);
		expect(html).toContain("items:");
		expect(html).toContain("[150]");
		expect(html).not.toContain("id:");
		const list = renderToStaticMarkup(
			createElement(McpJsonTree, {
				id: "long-list",
				value: Array.from({ length: 150 }, (_, n) => n),
			}),
		);
		expect(list).toContain("Show all 150");
		expect(list).toContain(">99<");
		expect(list).not.toContain(">100<");
	});

	it("shows empty objects and arrays as values rather than empty branches", () => {
		const html = renderToStaticMarkup(
			createElement(McpJsonTree, { id: "empty", value: { tags: [], meta: {} } }),
		);
		expect(html).toContain("tags:");
		expect(html).toContain(">[]<");
		expect(html).toContain(">{}<");
		expect(html).not.toContain("aria-expanded");
		expect(
			renderToStaticMarkup(createElement(McpJsonTree, { id: "empty-root", value: {} })),
		).toContain(">{}<");
	});

	it("says when structured content was too large to keep", () => {
		const html = renderTool(
			props(
				"mcp__fixture__big",
				{},
				{
					content: [{ type: "text", text: "ok" }],
					details: {
						server: "fixture",
						tool: "big",
						thinkrail: { blocks: [{ kind: "text", chars: 2 }], structuredContentTruncated: true },
					},
				},
			),
		);
		expect(html).toContain("Structured content too large to keep.");
		expect(html).not.toContain('data-testid="mcp-structured-toggle"');
	});

	it("paints an error result and turns pi's sign-in instruction into a Sign in action", () => {
		const result = { content: [{ type: "text", text: SIGN_IN_TEXT }], details: {} };
		const html = renderTool(props("mcp__linear__search_issues", { query: "bug" }, result, "error"));
		expect(html).toContain('data-server="linear"');
		expect(html).toContain('data-mcp-tool="search_issues"');
		expect(html).toMatch(
			/data-testid="mcp-output" data-failed="true" class="[^"]*text-feedback-error/,
		);
		expect(html).toContain('data-action="sign-in"');
		expect(html).toContain("Sign in</button>");

		const standalone = renderTool(
			props("mcp__linear__search_issues", { query: "bug" }, result, "error"),
			null,
		);
		expect(standalone).toContain(SIGN_IN_TEXT.replaceAll('"', "&quot;"));
		expect(standalone).not.toContain('data-testid="mcp-cli-action"');
	});

	it("offers no sign-in action on a successful result that happens to mention sign-in", () => {
		const html = renderTool(
			props(
				"mcp__jira__search",
				{},
				{
					content: [{ type: "text", text: "LOGIN-1: Login page needs sign-in button" }],
					details: { server: "jira", tool: "search" },
				},
			),
		);
		expect(html).not.toContain('data-testid="mcp-cli-action"');
	});

	it("renders an older transcript without details from its name and text", () => {
		const html = renderTool(
			props("mcp__docs__lookup", { id: 7 }, { content: [{ type: "text", text: "plain answer" }] }),
		);
		expect(html).toContain('data-server="docs"');
		expect(html).toContain('data-mcp-tool="lookup"');
		expect(html).toContain("plain answer");
		expect(html).not.toContain("Structured content");
		expect(html).not.toContain('data-testid="mcp-full-output"');
	});

	it("never crashes on odd details or result shapes", () => {
		for (const result of [
			null,
			"text only",
			{ content: "nope", details: { thinkrail: { blocks: [{ kind: "text" }] } } },
			{ content: [{ type: "text", text: 4 }], details: { server: 1, tool: null, thinkrail: 3 } },
		]) {
			expect(() => renderTool(props("mcp__x__y", {}, result))).not.toThrow();
		}
	});

	it("shows progress while running", () => {
		const html = renderTool(
			props(
				"mcp__fixture__big",
				{},
				{
					content: [{ type: "text", text: "Progress 2/5" }],
					details: { server: "fixture", tool: "big" },
				},
				"running",
			),
		);
		expect(html).toContain('data-testid="mcp-running"');
		expect(html).toContain("Progress 2/5");
		expect(html).not.toContain('data-testid="mcp-output"');
	});

	it("offers Full output only for a result that recorded one and only with a host to read it", () => {
		const result = {
			content: [{ type: "text", text: "Warning: truncated output" }],
			details: { server: "fixture", tool: "big", fullOutputPath: "/tmp/pi-mcp-big.txt" },
		};
		const html = renderTool(props("mcp__fixture__big", {}, result));
		expect(html).toContain('data-testid="mcp-full-output"');
		expect(html).toContain("Full output</button>");
		expect(renderTool(props("mcp__fixture__big", {}, result), null)).not.toContain(
			'data-testid="mcp-full-output"',
		);
		expect(
			renderTool(props("mcp__fixture__big", {}, result), actions({ readMcpOutput: undefined })),
		).not.toContain('data-testid="mcp-full-output"');
	});
});

describe("Full output states", () => {
	const renderBody = (state: Parameters<typeof McpFullOutputBody>[0]["state"]) =>
		renderToStaticMarkup(createElement(McpFullOutputBody, { state, onRetry: () => {} }));

	it("shows the text, and says when the host truncated it", () => {
		const full = renderBody({
			kind: "loaded",
			result: { available: true, text: "line 1\nline 2", truncated: false },
		});
		expect(full).toContain("line 1\nline 2");
		expect(full).not.toContain("Truncated");
		expect(
			renderBody({ kind: "loaded", result: { available: true, text: "head", truncated: true } }),
		).toContain('data-testid="mcp-full-output-truncated"');
	});

	it("shows the expired and unavailable states", () => {
		const expired = renderBody({ kind: "loaded", result: { available: false, reason: "expired" } });
		expect(expired).toContain('data-reason="expired"');
		expect(expired).toContain("The full output has expired.");
		const unavailable = renderBody({
			kind: "loaded",
			result: { available: false, reason: "unavailable" },
		});
		expect(unavailable).toContain('data-reason="unavailable"');
		expect(unavailable).not.toContain("expired");
	});

	it("shows loading and a retryable failure", () => {
		expect(renderBody({ kind: "loading" })).toContain("Loading the full output…");
		const failed = renderBody({ kind: "failed", message: "Session resources unavailable" });
		expect(failed).toContain('role="alert"');
		expect(failed).toContain("Session resources unavailable");
		expect(failed).toContain('data-testid="mcp-full-output-retry"');
	});
});

describe("resource cards", () => {
	const listing = {
		resources: [
			{ server: "docs", uri: "file:///a.md", name: "a.md", mimeType: "text/markdown" },
			{ server: "wiki", uri: "wiki://home", name: "home", title: "Home page" },
		],
		errors: [{ server: "linear", error: SIGN_IN_TEXT }],
	};

	it("lists every server's resources with a server column and per-server sign-in", () => {
		const html = renderTool(
			props(
				"list_mcp_resources",
				{},
				{
					content: [{ type: "text", text: JSON.stringify(listing) }],
					details: {
						server: "",
						tool: "list_mcp_resources",
						thinkrail: { blocks: [], structuredContent: listing },
					},
				},
			),
		);
		expect(html).toContain("All servers");
		expect(html.match(/data-testid="mcp-listed-item"/g)).toHaveLength(2);
		expect(html.match(/data-testid="mcp-listed-server"/g)).toHaveLength(2);
		expect(html).toContain("Home page");
		expect(html).toContain("file:///a.md · text/markdown");
		expect(html).toContain('data-testid="mcp-listing-error"');
		expect(html).toContain('data-action="sign-in"');
	});

	it("lists one server's templates from the JSON text without a server column", () => {
		const html = renderTool(
			props(
				"list_mcp_resource_templates",
				{ server: "docs" },
				{
					content: [
						{
							type: "text",
							text: JSON.stringify({
								server: "docs",
								resourceTemplates: [
									{ server: "docs", uriTemplate: "file:///{path}", name: "file" },
								],
								nextCursor: "c2",
							}),
						},
					],
					details: { server: "docs", tool: "list_mcp_resource_templates" },
				},
			),
		);
		expect(html).toContain(">docs</span>");
		expect(html).toContain("file:///{path}");
		expect(html).not.toContain('data-testid="mcp-listed-server"');
		expect(html).toContain("More resource templates on the next page.");
	});

	it("falls back to the raw text when pi truncated the listing, with Full output", () => {
		const text =
			'Warning: truncated output (original token count: 9000)\nTotal output lines: 1\n\n{"resources":[{"server":"docs"…31000 chars truncated…}]}\n\n[Full output: /tmp/pi-mcp-1.txt (read it with offset/limit)]';
		const html = renderTool(
			props(
				"list_mcp_resources",
				{},
				{
					content: [{ type: "text", text }],
					details: {
						server: "",
						tool: "list_mcp_resources",
						fullOutputPath: "/tmp/pi-mcp-1.txt",
						thinkrail: { blocks: [], structuredContentTruncated: true },
					},
				},
			),
		);
		expect(html).not.toContain('data-testid="mcp-listing"');
		expect(html).toContain("31000 chars truncated");
		expect(html).toContain('data-testid="mcp-full-output"');
	});

	it("says when a listing is empty", () => {
		const html = renderTool(
			props(
				"list_mcp_resources",
				{ server: "docs" },
				{
					content: [{ type: "text", text: '{"server":"docs","resources":[]}' }],
					details: { server: "docs", tool: "list_mcp_resources" },
				},
			),
		);
		expect(html).toContain("No resources.");
	});

	it("reads a resource: server and URI, then its content", () => {
		const html = renderTool(
			props(
				"read_mcp_resource",
				{ server: "docs", uri: "file:///a.md" },
				{
					content: [{ type: "text", text: "# A\nbody" }],
					details: {
						server: "docs",
						tool: "read_mcp_resource",
						thinkrail: {
							blocks: [
								{ kind: "resource", uri: "file:///a.md", mimeType: "text/markdown", chars: 8 },
							],
						},
					},
				},
			),
		);
		expect(html).toContain('data-testid="tool-read_mcp_resource"');
		expect(html).toContain(">docs</span>");
		expect(html).toContain("file:///a.md");
		expect(html).toContain("# A\nbody");
	});

	it("paints a failed read with the thrown message", () => {
		const html = renderTool(
			props(
				"read_mcp_resource",
				{ server: "nope", uri: "x://y" },
				{
					content: [{ type: "text", text: 'MCP server "nope" has no resources' }],
					details: {},
				},
				"error",
			),
		);
		expect(html).toContain('data-failed="true"');
		expect(html).toContain("has no resources");
		expect(html).not.toContain('data-testid="mcp-cli-action"');
	});
});

describe("tool_search card", () => {
	it("lists the loaded tools with pi's one-line descriptions", () => {
		const html = renderTool(
			props(
				"tool_search",
				{ query: "notes", limit: 3 },
				{
					content: [
						{
							type: "text",
							text: "Loaded 1 tool. They are available from your next call:\n- mcp__fixture__write_note: Store a note",
						},
					],
					details: { loaded: ["mcp__fixture__write_note"] },
				},
			),
		);
		expect(html).toContain(">notes</span>");
		expect(html).toContain("limit 3");
		expect(html).toContain("Loaded 1 tool, available from the next call");
		expect(html).toContain("mcp__fixture__write_note");
		expect(html).toContain("Store a note");
	});

	it("shows pi's own text when nothing matched or the details are unknown", () => {
		const none = renderTool(
			props(
				"tool_search",
				{ query: "zzz" },
				{ content: [{ type: "text", text: "No matching tools found." }], details: { loaded: [] } },
			),
		);
		expect(none).toContain("No matching tools found.");
		const odd = renderTool(
			props("tool_search", { query: "q" }, { content: [{ type: "text", text: "Something else" }] }),
		);
		expect(odd).toContain("Something else");
	});
});
