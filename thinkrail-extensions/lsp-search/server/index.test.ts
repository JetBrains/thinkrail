import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BRIDGE_UNAVAILABLE, createBridge } from "./bridge";
import { formatDefinition, formatOutline, formatReferences, formatSymbolSearch } from "./format";
import extension from "./index";
import { createLspSearchExtension, toBridgeParams } from "./tools";
import { LSP_BRIDGE_TOKEN_ENV, LSP_BRIDGE_URL_ENV } from "./wire";

interface Tool {
	name: string;
	description: string;
	execute: (
		id: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: { cwd: string },
	) => Promise<{ content: { type: string; text: string }[]; details: unknown }>;
}

function register(factory: ReturnType<typeof createLspSearchExtension>): Map<string, Tool> {
	const tools = new Map<string, Tool>();
	factory({ registerTool: (tool: Tool) => tools.set(tool.name, tool) } as unknown as ExtensionAPI);
	return tools;
}

const requests: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const body = (await request.json()) as Record<string, unknown>;
		requests.push({
			url: new URL(request.url).pathname,
			auth: request.headers.get("authorization"),
			body,
		});
		if (body.query === "boom") return Response.json({ ok: false, error: "worktree gone" });
		return Response.json({
			ok: true,
			result: {
				hits: [
					{
						name: "Widget",
						kind: "struct",
						container: null,
						path: "src/lib.rs",
						line: 1,
						preview: "pub struct Widget {\n    id: u32,",
						source: "lsp",
					},
				],
				source: "lsp",
				notes: [],
			},
		});
	},
});
afterAll(() => server.stop(true));

const bridge = createBridge({
	[LSP_BRIDGE_URL_ENV]: `http://127.0.0.1:${server.port}`,
	[LSP_BRIDGE_TOKEN_ENV]: "tok",
});

describe("lsp-search extension", () => {
	test("declares itself for the registry and both session kinds", () => {
		expect(extension.name).toBe("lsp-search");
		expect(extension.extensions).toHaveLength(1);
		expect(extension.childExtensions).toHaveLength(1);
	});

	test("registers the four navigation tools", () => {
		const tools = register(createLspSearchExtension(bridge));
		expect([...tools.keys()].sort()).toEqual([
			"code_file_outline",
			"code_find_references",
			"code_goto_definition",
			"code_symbol_search",
		]);
		for (const tool of tools.values()) expect(tool.description).toContain("Prefer this over grep");
	});

	test("calls the shell bridge with the session cwd and a bearer token", async () => {
		const tools = register(createLspSearchExtension(bridge));
		const result = await tools
			.get("code_symbol_search")
			?.execute("1", { query: "widget", kind_filter: "struct" }, undefined, undefined, {
				cwd: "/work/tree",
			});
		const call = requests.at(-1);
		expect(call?.url).toBe("/lsp/symbol_search");
		expect(call?.auth).toBe("Bearer tok");
		expect(call?.body).toEqual({
			query: "widget",
			kindFilter: "struct",
			worktreePath: "/work/tree",
		});
		expect(result?.content[0]?.text).toContain("src/lib.rs:1  struct Widget");
	});

	test("surfaces bridge errors as tool errors", async () => {
		const tools = register(createLspSearchExtension(bridge));
		await expect(
			tools
				.get("code_symbol_search")
				?.execute("1", { query: "boom" }, undefined, undefined, { cwd: "/w" }),
		).rejects.toThrow("worktree gone");
	});

	test("explains itself when the host has no LSP bridge", async () => {
		expect(createBridge({})).toBeNull();
		const tools = register(createLspSearchExtension(null));
		await expect(
			tools
				.get("code_file_outline")
				?.execute("1", { file_path: "a.ts" }, undefined, undefined, { cwd: "/w" }),
		).rejects.toThrow(BRIDGE_UNAVAILABLE);
	});

	test("maps snake_case tool parameters to the bridge's camelCase", () => {
		expect(
			toBridgeParams({
				file_path: "a.rs",
				symbol_name: "run",
				include_declaration: true,
				line: undefined,
			}),
		).toEqual({ filePath: "a.rs", symbolName: "run", includeDeclaration: true });
	});
});

describe("formatting", () => {
	test("renders references grouped by file", () => {
		const text = formatReferences({
			symbol: "run",
			total: 3,
			groups: [
				{
					path: "a.rs",
					count: 2,
					references: [
						{ line: 4, column: 9, snippet: "run();" },
						{ line: 9, column: 1, snippet: "run()" },
					],
				},
				{ path: "b.rs", count: 1, references: [{ line: 2, column: 5, snippet: "x.run()" }] },
			],
			notes: [],
		});
		expect(text).toContain("a.rs (2 references)");
		expect(text).toContain("b.rs (1 reference)");
		expect(text).toContain("a.rs:4:9  run();");
	});

	test("renders definitions, outlines and empty results", () => {
		expect(
			formatDefinition({
				symbol: "run",
				definitions: [
					{
						path: "a.rs",
						line: 3,
						column: 8,
						signature: "fn run()",
						blockStartLine: 3,
						blockEndLine: 4,
						block: "fn run() {\n}",
					},
				],
				notes: [],
			}),
		).toContain("a.rs:3:8  fn run()\nlines 3-4:");
		expect(
			formatOutline({
				path: "a.rs",
				source: "lsp",
				notes: [],
				nodes: [
					{
						name: "Foo",
						kind: "class",
						startLine: 1,
						endLine: 9,
						children: [{ name: "bar", kind: "method", startLine: 2, endLine: 4, children: [] }],
					},
				],
			}),
		).toBe("a.rs\n  class Foo  1..9\n    method bar  2..4");
		expect(formatSymbolSearch("zz", { hits: [], source: "text", notes: ["n"] })).toBe(
			'No symbols matching "zz".\n\nNote: n',
		);
	});
});
