import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { TranscriptBuilder, tempDir, writeSession } from "../test/builders.ts";
import { statsOver } from "../test/stats.ts";
import { buildSessionAnalysis } from "./analysis.ts";
import type { IndexState } from "./core.ts";
import { fileKey } from "./facts.ts";
import { buildFileDetail, buildSessionFiles } from "./files.ts";
import { buildStatsHotspots } from "./hotspots.ts";
import { folderRewriter, isWindowsPath, workspacePaths } from "./paths.ts";
import { createRedactor, secretFindings } from "./redact.ts";
import { SearchJobs } from "./search.ts";
import { TraceStore } from "./traceStore.ts";

const root = tempDir("paths");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = Date.parse("2026-11-04T09:00:00.000Z");
const redactor = createRedactor("/home/tester");
const READY: IndexState = { phase: "ready", indexed: 1, total: 1 };

const key = (raw: string, cwd: string) => fileKey(raw, workspacePaths(cwd), redactor);

describe("a session's path flavor", () => {
	test("is Windows for a drive letter or a UNC share, POSIX otherwise", () => {
		for (const path of ["C:\\repo", "c:/repo", "D:", "\\\\server\\share\\repo"])
			expect(isWindowsPath(path)).toBe(true);
		for (const path of ["/work/a", "repo", "~/x", "//", "C"])
			expect(isWindowsPath(path)).toBe(false);
	});

	test("a drive-letter folder: relative, absolute, mixed and other-case reads key the same file", () => {
		for (const raw of [
			"src/a.ts",
			"src\\a.ts",
			".\\src\\a.ts",
			"C:\\repo\\src\\a.ts",
			"c:/REPO/src/a.ts",
			"C:\\repo\\lib\\..\\src\\a.ts",
			"C:src\\a.ts",
			"@src\\a.ts",
		])
			expect(key(raw, "C:\\repo")).toEqual({ path: "src/a.ts", inside: true, lines: null });
		expect(key("node_modules\\x\\index.js", "C:\\repo\\")?.path).toBe("node_modules/x/index.js");
	});

	test("`..` escapes, other folders, drives and homes are outside and redacted", () => {
		const cwd = "C:\\repo";
		for (const raw of [
			"..\\other\\private.txt",
			"src\\..\\..\\other\\x.ts",
			"C:\\repo2\\x.ts",
			"D:\\repo\\src\\a.ts",
			"\\src\\a.ts",
			"D:src\\a.ts",
			"~\\notes.md",
			"C:\\repo",
		])
			expect(key(raw, cwd)?.inside).toBe(false);
		expect(key("..\\other\\private.txt", cwd)?.path).toBe("C:\\other\\private.txt");
		expect(key("C:\\Users\\bob\\notes.md", cwd)).toEqual({
			path: "~\\notes.md",
			inside: false,
			lines: null,
		});
		expect(key("c:/users/John Smith/notes.md", cwd)?.path).toBe("~\\notes.md");
	});

	test("a UNC folder resolves the same way", () => {
		const cwd = "\\\\server\\share\\repo";
		for (const raw of [
			"src\\a.ts",
			"\\\\server\\share\\repo\\src\\a.ts",
			"//SERVER/share/repo/src/a.ts",
		])
			expect(key(raw, cwd)).toMatchObject({ path: "src/a.ts", inside: true });
		expect(key("\\\\server\\share\\other\\a.ts", cwd)?.inside).toBe(false);
		expect(key("\\docs\\a.md", cwd)?.path).toBe("\\\\server\\share\\docs\\a.md");
	});

	test("POSIX folders keep their exact, case-sensitive rules", () => {
		const cwd = "/work/project";
		expect(key("/work/project/src/x.ts", cwd)?.path).toBe("src/x.ts");
		expect(key("src\\x.ts", cwd)).toMatchObject({ path: "src\\x.ts", inside: true });
		expect(key("/work/Project/src/x.ts", cwd)?.inside).toBe(false);
		expect(key("../x.ts", cwd)?.inside).toBe(false);
		expect(key("/work/project", cwd)?.inside).toBe(false);
	});

	test("Windows homes are masked in any case and with either separator", () => {
		const windows = createRedactor("C:\\Users\\alice");
		expect(windows.redact("C:\\Users\\alice\\repo and c:/users/ALICE/x")).toBe("~\\repo and ~/x");
		expect(redactor.redact("D:\\Users\\eve\\a and C:/Users/bob/b")).toBe("~\\a and ~/b");
		expect(secretFindings("see c:\\users\\bob\\x", "/home/tester")).toEqual(["homePath"]);
		expect(secretFindings("see C:\\Windows\\x and ~\\notes", "/home/tester")).toEqual([]);
	});

	test("a fixture rewrites a Windows folder in any spelling, the path after it with `/`", () => {
		const rewrite = folderRewriter("C:\\repo", "/tmp/w");
		expect(rewrite('read C:\\repo\\src\\a.ts and c:/Repo/b.md, not C:\\repo2\\x "C:\\repo"')).toBe(
			'read /tmp/w/src/a.ts and /tmp/w/b.md, not C:\\repo2\\x "/tmp/w"',
		);
		expect(folderRewriter("/work/a", "/tmp/w")("/work/a/x /work/ab")).toBe("/tmp/w/x /tmp/wb");
	});
});

function windowsSession(id: string, cwd: string): TranscriptBuilder {
	const builder = new TranscriptBuilder({ id, cwd, start: T0 });
	const ops: readonly [string, Record<string, unknown>, boolean?][] = [
		["read", { path: "src/a.ts" }],
		["read", { path: `${cwd}\\src\\a.ts` }],
		["edit", { path: ".\\SRC\\a.ts", edits: [] }],
		["write", { path: "docs\\notes.md", content: "a\nb\n" }],
		["read", { path: "..\\other\\private.txt" }],
		["read", { path: "node_modules\\x\\index.js" }],
		["read", { path: `${cwd}\\.pi\\skills\\fix-it\\SKILL.md` }],
		["read", { path: "C:\\Users\\bob\\.pi\\agent\\skills\\review\\skill.md" }],
	];
	builder.user("fix the parser");
	ops.forEach(([name, args, failed], at) => {
		const callId = `${id}-${at}`;
		builder.assistant({ toolCalls: [{ id: callId, name, arguments: args }] });
		builder.toolResult({
			toolCallId: callId,
			toolName: name,
			isError: failed === true,
			...(name === "edit" ? { details: { diff: "", patch: "--- a\n+++ b\n@@\n-x\n+y" } } : {}),
		});
	});
	builder.assistant({ text: "Done." });
	return builder;
}

describe("a Windows session", () => {
	for (const cwd of ["C:\\repo", "\\\\server\\share\\repo"])
		test(`keys its files and skills relative to ${cwd}`, async () => {
			const name = cwd.startsWith("C") ? "win-drive" : "win-unc";
			const file = writeSession(root, name, windowsSession(name, cwd));
			const store = new TraceStore({ redactor, sliceMs: 1000 });
			const trace = await store.trace(file);
			if (!trace) throw new Error("expected a trace");
			const files = buildSessionFiles(trace);
			const rows = Object.fromEntries(files.rows.map((row) => [row.path, row]));
			expect(Object.keys(rows).sort()).toEqual(
				[
					"src/a.ts",
					"docs/notes.md",
					"node_modules/x/index.js",
					".pi/skills/fix-it/SKILL.md",
					cwd.startsWith("C") ? "C:\\other\\private.txt" : "\\\\server\\share\\other\\private.txt",
					"~\\.pi\\agent\\skills\\review\\skill.md",
				].sort(),
			);
			expect(rows["src/a.ts"]).toMatchObject({ inside: true, reads: 2, edits: 1 });
			expect(rows["C:\\other\\private.txt"]?.inside ?? false).toBe(false);
			expect((await buildFileDetail(store, file, trace, "src/a.ts"))?.touches).toHaveLength(3);
			const { skills } = buildSessionAnalysis(trace, []);
			expect(skills.map((skill) => skill.name)).toEqual(["fix-it", "review"]);

			const { input } = await statsOver([file], {
				place: () => ({
					projectId: "p1",
					workspaceId: "w1",
					workspaceName: "main",
					workspace: "open",
				}),
			});
			const { hotspots } = await buildStatsHotspots(input, READY, { scope: { kind: "all" } });
			expect(hotspots.files.map((row) => row.path).sort()).toEqual(
				["src/a.ts", "docs/notes.md", ".pi/skills/fix-it/SKILL.md"].sort(),
			);
			expect(hotspots.outside).toBe(2);
			expect(hotspots.nodeModules).toBe(1);
			expect(hotspots.dirs.map((dir) => dir.path)).toContain("src");
			const jobs = new SearchJobs({ redactor });
			const answer = await jobs.run(input, READY, {
				scope: { kind: "all" },
				client: "panel",
				seq: 1,
				query: "file:src/a.ts",
			});
			expect(answer.total.events).toBe(3);
		});
});
