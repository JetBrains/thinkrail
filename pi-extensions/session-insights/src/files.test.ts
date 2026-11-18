import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { TranscriptBuilder, tempDir, writeSession } from "../test/builders.ts";
import { LARGE_TEST_MS, withinBudget } from "../test/perf.ts";
import { REWORK_CHANGES } from "./core.ts";
import { editLines, fileKey } from "./facts.ts";
import { buildFileDetail, buildSessionFiles, parseFileDetailParams } from "./files.ts";
import { workspacePaths } from "./paths.ts";
import { createRedactor } from "./redact.ts";
import { TraceStore } from "./traceStore.ts";

const root = tempDir("files");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = Date.parse("2026-11-04T09:00:00.000Z");
const redactor = createRedactor("/home/tester");
const CWD = "/work/project";

function patch(added: number, removed: number): string {
	return [
		"--- src/a.ts",
		"+++ src/a.ts",
		"@@ -3,2 +3,2 @@",
		...Array.from({ length: removed }, (_, at) => `-old ${at}`),
		...Array.from({ length: added }, (_, at) => `+new ${at}`),
	].join("\n");
}

function call(
	builder: TranscriptBuilder,
	id: string,
	name: string,
	args: Record<string, unknown>,
	result: { details?: unknown; isError?: boolean; text?: string } = {},
) {
	builder.assistant({ toolCalls: [{ id, name, arguments: args }] });
	builder.toolResult({ toolCallId: id, toolName: name, ...result });
}

function filesSession() {
	const builder = new TranscriptBuilder({ id: "files", start: T0, cwd: CWD });
	builder.user("fix the parser");
	call(builder, "r1", "read", { path: "src/a.ts" });
	call(builder, "r2", "read", { path: "/home/tester/.pi/skills/fix/SKILL.md" });
	call(
		builder,
		"e1",
		"edit",
		{ path: "/work/project/src/a.ts", edits: [] },
		{
			details: { patch: patch(2, 1), diff: "", firstChangedLine: 3 },
		},
	);
	call(
		builder,
		"e2",
		"edit",
		{ path: "./src/a.ts", edits: [] },
		{
			isError: true,
			text: "Could not find the exact text in src/a.ts",
		},
	);
	call(
		builder,
		"e3",
		"edit",
		{ path: "src/a.ts", edits: [] },
		{
			details: { patch: patch(1, 1), diff: "", firstChangedLine: 9 },
		},
	);
	builder.user("and the docs");
	call(builder, "w1", "write", { path: "docs/parser.md", content: "# Parser\n\nIt parses.\n" });
	for (const id of ["e4", "e5"])
		call(
			builder,
			id,
			"edit",
			{ path: "src/a.ts", edits: [] },
			{
				details: { patch: patch(1, 0), diff: "", firstChangedLine: 12 },
			},
		);
	call(builder, "w2", "write", { path: "src/a.ts", content: "export {};\n" });
	call(builder, "r3", "read", { path: "src/b.ts" });
	return builder;
}

async function loaded(name: string, builder: TranscriptBuilder) {
	const store = new TraceStore({ sliceMs: 1000, redactor });
	const file = writeSession(root, name, builder);
	const trace = await store.trace(file);
	if (!trace) throw new Error("no trace");
	return { store, file, trace };
}

describe("file × turn matrix", () => {
	test("reads, edits, writes and failed edits per turn, with rework past the threshold", async () => {
		const { trace } = await loaded("matrix", filesSession());
		const files = buildSessionFiles(trace);
		expect(files.columns).toBe("turns");
		expect(files.cols.map((column) => column.turnN)).toEqual([1, 2]);
		expect(files.cols[0]?.title).toBe("fix the parser");
		const [main, docs, b, skill] = files.rows;
		expect(main).toMatchObject({
			path: "src/a.ts",
			inside: true,
			reads: 1,
			edits: 4,
			writes: 1,
			failed: 1,
			added: 6,
			removed: 2,
			rework: true,
			cells: [
				[0, 1, 2, 0, 1],
				[1, 0, 2, 1, 0],
			],
			receipt: null,
		});
		expect(REWORK_CHANGES).toBe(5);
		expect(docs).toMatchObject({ path: "docs/parser.md", writes: 1, added: 3, rework: false });
		expect(b).toMatchObject({ path: "src/b.ts", reads: 1, edits: 0 });
		expect(skill).toMatchObject({ path: "~/.pi/skills/fix/SKILL.md", inside: false, reads: 1 });
		expect(files.totals).toEqual({
			files: 4,
			changed: 2,
			readOnly: 2,
			rework: 1,
			failed: 1,
			added: 9,
			removed: 2,
		});
		expect(files.receipts).toBe(false);
	});

	test("few turns with a plan split into plan-step columns", async () => {
		const builder = new TranscriptBuilder({ id: "steps", start: T0, cwd: CWD });
		builder.user("two steps");
		const item = (id: string, status: string) => ({
			id,
			title: `Step ${id}`,
			status,
			origin: "agent",
		});
		call(
			builder,
			"w",
			"todo_write",
			{},
			{
				details: { plan: { todos: [item("t_1", "pending"), item("t_2", "pending")], groups: [] } },
			},
		);
		call(
			builder,
			"u1",
			"todo_update",
			{},
			{ details: { todo: item("t_1", "in_progress"), paused: [] } },
		);
		call(builder, "e1", "edit", { path: "a.ts" }, { details: { patch: patch(1, 0) } });
		call(
			builder,
			"u2",
			"todo_update",
			{},
			{ details: { todo: item("t_2", "in_progress"), paused: [] } },
		);
		call(builder, "e2", "edit", { path: "a.ts" }, { details: { patch: patch(1, 0) } });
		const { trace } = await loaded("steps", builder);
		const files = buildSessionFiles(trace);
		expect(files.columns).toBe("steps");
		expect(files.cols.map((column) => [column.turnN, column.stepN, column.title])).toEqual([
			[1, 1, "Step t_1"],
			[1, 2, "Step t_2"],
		]);
		expect(files.rows[0]?.cells).toEqual([
			[0, 0, 1, 0, 0],
			[1, 0, 1, 0, 0],
		]);
	});

	test("receipts the embedder recorded join the rows by path", async () => {
		const { trace } = await loaded("receipts", filesSession());
		const files = buildSessionFiles(trace, [
			{
				startedAt: T0,
				settledAt: T0 + 60_000,
				changes: [
					{ path: "src/a.ts", status: "modified", added: 7, removed: 3 },
					{ path: "src/generated.ts", status: "added", added: 40 },
				],
			},
		]);
		expect(files.receipts).toBe(true);
		expect(files.rows[0]?.receipt).toEqual({ added: 7, removed: 3, runs: 1 });
		expect(files.rows.find((row) => row.path === "src/b.ts")?.receipt).toBeNull();
	});

	test("a file's touches and its diffs from the edit patches and written content", async () => {
		const { store, file, trace } = await loaded("detail", filesSession());
		const receipts = [
			{
				startedAt: T0,
				settledAt: T0 + 1,
				changes: [{ path: "src/a.ts", status: "modified", added: 7, removed: 3 }],
			},
		];
		const detail = await buildFileDetail(store, file, trace, "src/a.ts", receipts);
		if (!detail) throw new Error("no detail");
		expect(
			detail.touches.map((touch) => [touch.op, touch.failed, touch.column, touch.line]),
		).toEqual([
			["read", false, 0, null],
			["edit", false, 0, 3],
			["edit", true, 0, null],
			["edit", false, 0, 9],
			["edit", false, 1, 12],
			["edit", false, 1, 12],
			["write", false, 1, null],
		]);
		expect(detail.diffs.map((diff) => diff.op)).toEqual(["edit", "edit", "edit", "edit", "write"]);
		expect(detail.diffs[0]?.text.text).toBe(patch(2, 1));
		expect(detail.diffs[0]?.line).toBe(3);
		expect(detail.diffs.at(-1)?.text.text).toBe("export {};\n");
		expect(detail.receipts).toEqual([
			{ startedAt: T0, settledAt: T0 + 1, status: "modified", added: 7, removed: 3 },
		]);
		expect(await buildFileDetail(store, file, trace, "nope.ts")).toBeNull();
		expect(() => parseFileDetailParams({ sessionId: "s", path: "" })).toThrow();
	});

	test("paths resolve against the session folder; anything outside is redacted, never opened", () => {
		expect(fileKey("/work/project/src/x.ts", workspacePaths(CWD), redactor)).toEqual({
			path: "src/x.ts",
			inside: true,
			lines: null,
		});
		expect(fileKey("./a/../b.ts", workspacePaths(CWD), redactor)?.path).toBe("b.ts");
		expect(fileKey("../other/c.ts", workspacePaths(CWD), redactor)).toMatchObject({
			inside: false,
		});
		expect(fileKey("/home/tester/notes.md", workspacePaths(CWD), redactor)).toMatchObject({
			path: "~/notes.md",
			inside: false,
		});
		expect(fileKey("/work/project-other/x.ts", workspacePaths(CWD), redactor)?.inside).toBe(false);
		expect(editLines({ diff: "+12 a\n-12 b\n-13 c\n 14 d" })).toEqual({
			added: 1,
			removed: 2,
			line: null,
		});
		expect(editLines(undefined)).toBeNull();
	});

	test("the same trace builds byte-identically", async () => {
		const { trace } = await loaded("again", filesSession());
		const first = JSON.stringify(buildSessionFiles(trace));
		expect(JSON.stringify(buildSessionFiles(trace))).toBe(first);
	});
});

describe("budgets", () => {
	test(
		"a 2,400-call session's files build within the summary budget and stay under 1 MB",
		async () => {
			const builder = new TranscriptBuilder({ id: "large-files", start: T0, cwd: CWD });
			for (let turn = 0; turn < 120; turn += 1) {
				builder.user(`turn ${turn}`);
				for (let at = 0; at < 20; at += 1) {
					const name = at % 2 ? "read" : "edit";
					call(
						builder,
						`c${turn}-${at}`,
						name,
						{ path: `src/file${at % 7}.ts` },
						{
							details: name === "edit" ? { patch: patch(1, 1) } : undefined,
						},
					);
				}
			}
			const { trace } = await loaded("large-files", builder);
			const started = performance.now();
			const files = buildSessionFiles(trace);
			withinBudget(performance.now() - started, 500);
			expect(files.cols).toHaveLength(120);
			expect(files.rows).toHaveLength(7);
			expect(JSON.stringify(files).length).toBeLessThan(1_000_000);
		},
		LARGE_TEST_MS,
	);
});
