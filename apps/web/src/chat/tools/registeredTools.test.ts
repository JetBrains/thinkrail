import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	DefaultToolRenderer,
	getToolRenderer,
	getToolSummary,
	type ToolRenderProps,
} from "../toolRegistry";
import "./register";
import { specToolPaths, splitKnownPathReferences } from "./SpecToolCard";

const INTENTIONAL_TOOLS = [
	"read",
	"write",
	"edit",
	"bash",
	"web_search",
	"fetch_content",
	"get_search_content",
	"visualize",
	"spec_grep",
	"spec_get",
	"spec_graph",
	"spec_create",
	"spec_update",
	"spec_delete",
	"spec_validate",
	"ask_user_question",
	"resolve_comment",
] as const;

function props(
	toolName: string,
	args: Record<string, unknown>,
	result: unknown,
): ToolRenderProps & { onOpenFile: (path: string) => void } {
	return {
		toolCallId: `${toolName}-call`,
		toolName,
		args,
		result,
		status: "done",
		workspaceRoot: "/repo",
		streaming: false,
		onOpenFile: () => {},
	};
}

function renderTool(toolName: string, args: Record<string, unknown>, result: unknown): string {
	return renderToStaticMarkup(
		createElement(getToolRenderer(toolName), props(toolName, args, result)),
	);
}

describe("intentional bundled tool renderers", () => {
	it("extracts paths only from each spec tool's known structured result fields", () => {
		const cases: Array<[string, Record<string, unknown>, unknown, string[]]> = [
			[
				"spec_grep",
				{},
				{ details: { matches: [{ path: "grep/SPEC.md" }, { path: 42 }] } },
				["grep/SPEC.md"],
			],
			[
				"spec_get",
				{},
				{
					details: {
						path: "get/SPEC.md",
						links: [{ path: "forward/SPEC.md" }, { path: null }],
						reverseLinks: [{ path: "reverse/SPEC.md" }],
					},
				},
				["get/SPEC.md", "forward/SPEC.md", "reverse/SPEC.md"],
			],
			["spec_graph", {}, { details: { nodes: [{ path: "graph/SPEC.md" }] } }, ["graph/SPEC.md"]],
			[
				"spec_create",
				{ path: "create/SPEC.md" },
				{ details: { path: "create/SPEC.md" } },
				["create/SPEC.md"],
			],
			["spec_update", {}, { details: { path: "update/SPEC.md" } }, ["update/SPEC.md"]],
			["spec_delete", {}, { details: { path: "deleted/SPEC.md" } }, []],
			[
				"spec_validate",
				{},
				{
					details: {
						duplicateIds: [{ paths: ["one/SPEC.md", "two/SPEC.md"] }],
						danglingLinks: [{ fromPath: "source/SPEC.md" }],
					},
				},
				["one/SPEC.md", "two/SPEC.md", "source/SPEC.md"],
			],
		];

		for (const [toolName, args, result, expected] of cases) {
			expect(specToolPaths(toolName, args, result)).toEqual(expected);
		}
	});

	it("segments exact known path strings without letting a shorter path split a longer one", () => {
		const text = "root SPEC.md; child module-a/SPEC.md; done";
		const segments = splitKnownPathReferences(text, ["SPEC.md", "module-a/SPEC.md"]);

		expect(segments.map((segment) => segment.path).filter(Boolean)).toEqual([
			"SPEC.md",
			"module-a/SPEC.md",
		]);
		expect(segments.map((segment) => segment.text).join("")).toBe(text);
	});

	it("does not link a known path as a suffix inside another path", () => {
		const text = "foreign /tmp/SPEC.md; local SPEC.md:12; backup SPEC.md.bak; nested other/SPEC.md";
		const segments = splitKnownPathReferences(text, ["SPEC.md"]);

		expect(segments.map((segment) => segment.path).filter(Boolean)).toEqual(["SPEC.md"]);
		expect(segments.map((segment) => segment.text).join("")).toBe(text);
	});

	it("registers every non-TODO tool exposed by a normal session", () => {
		for (const toolName of INTENTIONAL_TOOLS) {
			expect(getToolRenderer(toolName)).not.toBe(DefaultToolRenderer);
		}
	});

	it("leaves the five TODO tools on their plan-owned fallback receipts", () => {
		for (const toolName of ["todo_list", "todo_add", "todo_update", "todo_remove", "todo_write"]) {
			expect(getToolRenderer(toolName)).toBe(DefaultToolRenderer);
		}
	});

	it("renders only structured in-worktree spec_get paths as exact preview links", () => {
		const html = renderTool(
			"spec_get",
			{ id: "sample-root" },
			{
				content: [
					{
						type: "text",
						text: [
							"sample-root [goal-and-requirements] — Sample Project",
							"path: SPEC.md",
							"links:",
							"  parent -> sample-parent (module-a/SPEC.md)",
							"  references -> foreign (/tmp/outside.md)",
						].join("\n"),
					},
				],
				details: {
					path: "SPEC.md",
					links: [{ path: "module-a/SPEC.md" }, { path: "/tmp/outside.md" }],
					reverseLinks: [],
				},
			},
		);

		expect(html).not.toContain("&quot;id&quot;");
		expect(html.match(/data-testid="tool-file-link"/g)).toHaveLength(2);
		expect(html).toContain('data-path="SPEC.md"');
		expect(html).toContain('data-path="module-a/SPEC.md"');
		expect(html).toContain("/tmp/outside.md");
		expect(html).not.toContain('data-path="/tmp/outside.md"');
	});

	it("keeps a failed spec mutation path inert", () => {
		const rendererProps = props(
			"spec_create",
			{ path: "missing/SPEC.md", id: "missing" },
			{
				content: [{ type: "text", text: "Error: failed to create missing/SPEC.md" }],
				details: { path: "missing/SPEC.md", error: "failed" },
			},
		);
		const html = renderToStaticMarkup(
			createElement(getToolRenderer("spec_create"), { ...rendererProps, status: "error" }),
		);

		expect(html).toContain("missing/SPEC.md");
		expect(html).not.toContain('data-testid="tool-file-link"');
	});

	it("keeps a successful spec_delete path inert", () => {
		const html = renderTool(
			"spec_delete",
			{ id: "removed" },
			{
				content: [{ type: "text", text: "Deleted removed/SPEC.md (id: removed)." }],
				details: { id: "removed", path: "removed/SPEC.md" },
			},
		);

		expect(html).toContain("removed/SPEC.md");
		expect(html).not.toContain('data-testid="tool-file-link"');
	});

	it("summarizes the first query, URL, or selected stored-content target", () => {
		expect(
			getToolSummary(
				"web_search",
				props("web_search", { queries: ["first query", "second query"] }, null),
			),
		).toBe("first query");
		expect(
			getToolSummary(
				"fetch_content",
				props(
					"fetch_content",
					{ urls: ["https://example.com/one", "https://example.com/two"] },
					null,
				),
			),
		).toBe("https://example.com/one");
		expect(
			getToolSummary(
				"get_search_content",
				props(
					"get_search_content",
					{ responseId: "response-123", urlIndex: 0 },
					{
						details: { url: "https://example.com/selected" },
					},
				),
			),
		).toBe("https://example.com/selected");
	});

	it("treats only HTTP fetch targets as external links and gates local targets as files", () => {
		const result = { content: [{ type: "text", text: "Fetched." }] };
		const external = renderTool("fetch_content", { url: "https://www.example.com/docs" }, result);
		const local = renderTool("fetch_content", { url: "module-a/SPEC.md" }, result);
		const foreign = renderTool("fetch_content", { url: "/tmp/video.mp4" }, result);

		expect(external).toContain('href="https://www.example.com/docs"');
		expect(external).toContain(">example.com</a>");
		expect(local).toContain('data-path="module-a/SPEC.md"');
		expect(foreign).not.toContain('data-testid="tool-file-link"');
		expect(foreign).toContain("/tmp/video.mp4");
	});

	it("renders search and stored web content as Markdown with safe external links", () => {
		for (const [toolName, args] of [
			["web_search", { query: "preview tabs" }],
			["get_search_content", { responseId: "response-123", queryIndex: 0 }],
		] as const) {
			const html = renderTool(toolName, args, {
				content: [
					{ type: "text", text: "# Answer\n\nRead the [source](https://example.com/source)." },
				],
				details: { query: "preview tabs" },
			});
			expect(html).toContain("<h1>Answer</h1>");
			expect(html).toContain('href="https://example.com/source"');
			expect(html).not.toContain("&quot;responseId&quot;");
		}
	});
});
