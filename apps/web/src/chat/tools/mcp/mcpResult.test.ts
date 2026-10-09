import { describe, expect, it } from "bun:test";
import {
	mcpArgEntries,
	mcpArgsSummary,
	mcpCallTitle,
	mcpCliAction,
	mcpFullOutputPath,
	mcpText,
	parseMcpListing,
	parseMcpToolName,
	readMcpListing,
	readMcpResultSummary,
	readMcpToolDetails,
	readToolSearchLoaded,
	toolSearchDescriptions,
} from "./mcpResult";

describe("MCP tool names", () => {
	it("splits mcp__<server>__<tool> at the first separator after the prefix", () => {
		expect(parseMcpToolName("mcp__linear__search_issues")).toEqual({
			server: "linear",
			tool: "search_issues",
		});
		expect(parseMcpToolName("mcp__docs__get__page")).toEqual({ server: "docs", tool: "get__page" });
		expect(parseMcpToolName("mcp__lonely")).toEqual({ server: "lonely", tool: "" });
		expect(parseMcpToolName("read_mcp_resource")).toBeNull();
		expect(parseMcpToolName("mcp_single__x")).toBeNull();
	});

	it("titles a call from details first and from the name when the call threw", () => {
		const details = { server: "my-server", tool: "search-issues" };
		expect(mcpCallTitle("mcp__my_server__search_issues", { details })).toEqual(details);
		expect(mcpCallTitle("mcp__linear__search", { content: [], details: {} })).toEqual({
			server: "linear",
			tool: "search",
		});
		expect(mcpCallTitle("mcp__linear__search", undefined)).toEqual({
			server: "linear",
			tool: "search",
		});
		expect(mcpCallTitle("odd_tool", { details: { server: 1 } })).toEqual({
			server: "",
			tool: "odd_tool",
		});
	});
});

describe("details and summary guards", () => {
	it("reads McpToolDetails only when server and tool are strings", () => {
		expect(
			readMcpToolDetails({ details: { server: "s", tool: "t", fullOutputPath: "/tmp/o" } }),
		).toEqual({ server: "s", tool: "t", fullOutputPath: "/tmp/o" });
		expect(readMcpToolDetails({ details: { server: "", tool: "list_mcp_resources" } })).toEqual({
			server: "",
			tool: "list_mcp_resources",
		});
		expect(readMcpToolDetails({ details: { server: "s", tool: 4 } })).toBeNull();
		expect(readMcpToolDetails({ details: "s/t" })).toBeNull();
		expect(readMcpToolDetails(null)).toBeNull();
		expect(readMcpToolDetails("text")).toBeNull();
	});

	it("finds a recorded full-output path and ignores empty or non-string ones", () => {
		expect(mcpFullOutputPath({ details: { fullOutputPath: "/tmp/pi-mcp-1.txt" } })).toBe(
			"/tmp/pi-mcp-1.txt",
		);
		expect(mcpFullOutputPath({ details: { fullOutputPath: "" } })).toBeNull();
		expect(mcpFullOutputPath({ details: { fullOutputPath: 7 } })).toBeNull();
		expect(mcpFullOutputPath({ details: [] })).toBeNull();
	});

	it("reads the host summary, dropping malformed blocks and non-boolean flags", () => {
		const summary = readMcpResultSummary({
			details: {
				server: "fixture",
				tool: "rich",
				thinkrail: {
					blocks: [
						{ kind: "text", chars: 11 },
						{ kind: "image", mimeType: "image/png" },
						{ kind: "audio" },
						{ kind: "resource_link", uri: "file:///a.md", name: "a.md", mimeType: "text/markdown" },
						{ kind: "resource_link", uri: "file:///b.md", name: 3 },
						{ kind: "resource", uri: "file:///c.txt", chars: 3 },
						{ kind: "video", uri: "x" },
						"text",
					],
					structuredContent: { rows: [{ id: 1 }] },
					structuredContentTruncated: "yes",
					isError: true,
				},
			},
		});
		expect(summary).toEqual({
			blocks: [
				{ kind: "text", chars: 11 },
				{ kind: "image", mimeType: "image/png" },
				{ kind: "resource_link", uri: "file:///a.md", name: "a.md", mimeType: "text/markdown" },
				{ kind: "resource", uri: "file:///c.txt", chars: 3 },
			],
			structuredContent: { rows: [{ id: 1 }] },
			isError: true,
		});
		expect(
			readMcpResultSummary({
				details: { thinkrail: { blocks: [], structuredContentTruncated: true } },
			}),
		).toEqual({ blocks: [], structuredContentTruncated: true });
	});

	it("treats a missing or odd summary (an older transcript) as absent", () => {
		expect(readMcpResultSummary({ details: { server: "s", tool: "t" } })).toBeNull();
		expect(readMcpResultSummary({ details: { thinkrail: { blocks: "text" } } })).toBeNull();
		expect(readMcpResultSummary({ details: { thinkrail: null } })).toBeNull();
		expect(readMcpResultSummary(undefined)).toBeNull();
	});
});

describe("text and arguments", () => {
	it("joins text blocks with newlines and skips images", () => {
		expect(
			mcpText({
				content: [
					{ type: "text", text: "rich result" },
					{ type: "image", data: "AAAA", mimeType: "image/png" },
					{ type: "text", text: '[Resource file:///notes/a.md "a.md" (text/markdown)]' },
				],
			}),
		).toBe('rich result\n[Resource file:///notes/a.md "a.md" (text/markdown)]');
		expect(mcpText(undefined)).toBe("");
		expect(mcpText("plain")).toBe("plain");
	});

	it("shows string arguments raw and others as JSON", () => {
		expect(mcpArgEntries({ query: "auth bug", limit: 5, filter: { state: "open" } })).toEqual([
			{ key: "query", value: "auth bug" },
			{ key: "limit", value: "5" },
			{ key: "filter", value: '{\n  "state": "open"\n}' },
		]);
	});

	it("summarizes arguments as pi's collapsed key=value pairs, cut to one line", () => {
		expect(mcpArgsSummary({ query: "auth bug", limit: 5 })).toBe('query="auth bug" limit=5');
		expect(mcpArgsSummary({})).toBe("");
		const long = mcpArgsSummary({ text: "x".repeat(300) });
		expect(long).toHaveLength(100);
		expect(long.endsWith("…")).toBe(true);
	});
});

describe("pi's CLI-oriented phrases", () => {
	it("turns sign-in instructions into a Sign in action", () => {
		for (const text of [
			'MCP server "linear" requires sign-in. Run /mcp to sign in.',
			'MCP server "gh" requires sign-in. Run /login github to sign in.',
			"linear: needs sign-in, run /mcp login linear (deferred)",
			"If it requires sign-in: pi mcp login linear",
		]) {
			expect(mcpCliAction(text)).toBe("sign-in");
		}
	});

	it("turns other /mcp instructions into an Open MCP settings action", () => {
		expect(mcpCliAction("MCP servers need attention:\n  docs: failed\nRun /mcp to fix.")).toBe(
			"settings",
		);
	});

	it("ignores text that merely mentions an /mcp endpoint or nothing at all", () => {
		expect(
			mcpCliAction('MCP server "docs" failed to connect: POST https://x.dev/mcp 500'),
		).toBeNull();
		expect(mcpCliAction("POST /mcp returned 404")).toBeNull();
		expect(mcpCliAction("")).toBeNull();
	});
});

describe("resource listings", () => {
	const resources = {
		resources: [
			{ server: "docs", uri: "file:///a.md", name: "a.md", mimeType: "text/markdown" },
			{
				server: "wiki",
				uri: "wiki://home",
				name: "home",
				title: "Home page",
				description: "Start",
			},
			{ server: "docs", name: "no uri" },
			"junk",
		],
		errors: [
			{ server: "linear", error: 'MCP server "linear" requires sign-in. Run /mcp to sign in.' },
		],
	};

	it("parses resources and templates, keeping only items with a URI", () => {
		expect(parseMcpListing("list_mcp_resources", resources)).toEqual({
			items: [
				{ server: "docs", uri: "file:///a.md", name: "a.md", mimeType: "text/markdown" },
				{
					server: "wiki",
					uri: "wiki://home",
					name: "home",
					title: "Home page",
					description: "Start",
				},
			],
			errors: [
				{ server: "linear", error: 'MCP server "linear" requires sign-in. Run /mcp to sign in.' },
			],
		});
		expect(
			parseMcpListing("list_mcp_resource_templates", {
				server: "docs",
				resourceTemplates: [{ uriTemplate: "file:///{path}", name: "file" }],
				nextCursor: "c2",
			}),
		).toEqual({
			items: [{ server: "docs", uri: "file:///{path}", name: "file" }],
			nextCursor: "c2",
			errors: [],
		});
		expect(parseMcpListing("list_mcp_resources", { resourceTemplates: [] })).toBeNull();
		expect(parseMcpListing("read_mcp_resource", resources)).toBeNull();
	});

	it("prefers the host's structured payload, then the JSON text", () => {
		const fromSummary = readMcpListing("list_mcp_resources", {
			content: [{ type: "text", text: "not json" }],
			details: {
				server: "",
				tool: "list_mcp_resources",
				thinkrail: { blocks: [], structuredContent: resources },
			},
		});
		expect(fromSummary?.items).toHaveLength(2);
		const fromText = readMcpListing("list_mcp_resources", {
			content: [
				{ type: "text", text: JSON.stringify({ server: "docs", resources: resources.resources }) },
			],
			details: { server: "docs", tool: "list_mcp_resources" },
		});
		expect(fromText?.items.map((item) => item.uri)).toEqual(["file:///a.md", "wiki://home"]);
	});

	it("tolerates pi's truncated JSON text by reporting no listing", () => {
		const text = `Warning: truncated output (original token count: 9000)\nTotal output lines: 1\n\n{"resources":[{"server":"docs","uri":"file:///a…31000 chars truncated…"}]}\n\n[Full output: /tmp/pi-mcp-1.txt (read it with offset/limit)]`;
		expect(
			readMcpListing("list_mcp_resources", {
				content: [{ type: "text", text }],
				details: { server: "", tool: "list_mcp_resources", fullOutputPath: "/tmp/pi-mcp-1.txt" },
			}),
		).toBeNull();
		expect(
			readMcpListing("list_mcp_resources", { content: [{ type: "text", text: '{"resources":' }] }),
		).toBeNull();
	});
});

describe("tool_search", () => {
	it("reads the loaded tool names and the one-line descriptions pi printed", () => {
		const text =
			"Loaded 2 tools. They are available from your next call:\n- mcp__fixture__echo: Echo the text back\n- mcp__fixture__write_note: Store a note";
		expect(
			readToolSearchLoaded({
				details: { loaded: ["mcp__fixture__echo", 3, "mcp__fixture__write_note"] },
			}),
		).toEqual(["mcp__fixture__echo", "mcp__fixture__write_note"]);
		expect(readToolSearchLoaded({ details: {} })).toBeNull();
		expect(toolSearchDescriptions(text).get("mcp__fixture__write_note")).toBe("Store a note");
		expect(toolSearchDescriptions("No matching tools found.").size).toBe(0);
	});
});
