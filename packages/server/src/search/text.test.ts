import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, TextSearchBatch, TextSearchMatch, Workspace } from "@thinkrail/contracts";
import { TEXT_SEARCH_LIMITS } from "@thinkrail/contracts";
import type { SearchRoot } from "./providers";
import { createSearchService } from "./service";
import { cutLine, grepRecords, matchRanges, searchText, type TextQuery } from "./text";

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
	for (const part of parts) yield new TextEncoder().encode(part);
}

async function collect(root: SearchRoot, query: TextQuery, signal = new AbortController().signal) {
	const batches: Omit<TextSearchBatch, "seq">[] = [];
	await searchText(root, query, (batch) => batches.push(batch), signal);
	const files = new Map<string, TextSearchMatch[]>();
	for (const batch of batches) {
		for (const file of batch.files)
			files.set(file.path, [...(files.get(file.path) ?? []), ...file.matches]);
	}
	return { files, done: batches.at(-1)?.done, batches };
}

const query = (text: string, flags: Partial<TextQuery> = {}): TextQuery => ({
	query: text,
	caseSensitive: false,
	wholeWord: false,
	...flags,
});

describe("text search parsing", () => {
	test("records split on NUL and newline, across chunks, with CRLF trimmed", async () => {
		const records = [];
		for await (const record of grepRecords(
			chunks("a b.ts\u00003\u0000hello wor", "ld\r\nc.md\u000012\u0000x\n"),
		)) {
			records.push(record);
		}
		expect(records).toEqual([
			{ path: "a b.ts", line: 3, text: "hello world" },
			{ path: "c.md", line: 12, text: "x" },
		]);
	});

	test("ranges honour case and whole words; a long line is cut around its first match", () => {
		expect(matchRanges("Session session SESSIONS", query("session"))).toEqual([
			[0, 7],
			[8, 15],
			[16, 23],
		]);
		expect(matchRanges("Session session", query("session", { caseSensitive: true }))).toEqual([
			[8, 15],
		]);
		expect(matchRanges("rename renameSession", query("rename", { wholeWord: true }))).toEqual([
			[0, 6],
		]);
		const long = `${"x".repeat(1000)}needle${"y".repeat(1000)}`;
		const cut = cutLine(long, [[1000, 1006]]);
		expect(cut.text.length).toBeLessThanOrEqual(TEXT_SEARCH_LIMITS.lineChars + 2);
		expect(cut.text.startsWith("…")).toBe(true);
		const [range] = cut.ranges;
		expect(range && cut.text.slice(range[0], range[1])).toBe("needle");
	});
});

describe("searchText", () => {
	let dir: string;
	let plain: string;
	let root: SearchRoot;
	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "thinkrail-text-"));
		plain = mkdtempSync(join(tmpdir(), "thinkrail-text-plain-"));
		const git = (...args: string[]) => {
			const result = Bun.spawnSync(["git", "-C", dir, ...args], {
				stdout: "ignore",
				stderr: "ignore",
			});
			if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
		};
		git("init", "-q", "-b", "main");
		mkdirSync(join(dir, "src", "deep dir"), { recursive: true });
		writeFileSync(join(dir, "src", "deep dir", "spaced name.ts"), "const Needle = 1;\nneedle();\n");
		writeFileSync(join(dir, "src", "ünïcode.md"), "a needle here\n");
		writeFileSync(join(dir, "tracked.txt"), "needles and a needle\n");
		writeFileSync(join(dir, ".gitignore"), "ignored.log\n");
		writeFileSync(join(dir, "ignored.log"), "needle\n");
		writeFileSync(join(dir, "binary.bin"), Buffer.from([0, 1, 2, ...Buffer.from("needle"), 0]));
		writeFileSync(join(dir, "big.txt"), `needle\n${"z".repeat(TEXT_SEARCH_LIMITS.fileBytes)}\n`);
		writeFileSync(join(dir, "many.txt"), "repeat\n".repeat(TEXT_SEARCH_LIMITS.lines + 50));
		git("add", "tracked.txt", "src");
		writeFileSync(join(plain, "a.txt"), "plain needle\n");
		root = { root: dir, projectId: "p", workspaceId: "w", git: true };
	});
	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
		rmSync(plain, { recursive: true, force: true });
	});

	test("tracked and new files match; ignored, binary and oversized files never do", async () => {
		const { files, done } = await collect(root, query("NEEDLE", { caseSensitive: false }));
		expect([...files.keys()].sort()).toEqual([
			"src/deep dir/spaced name.ts",
			"src/ünïcode.md",
			"tracked.txt",
		]);
		expect(done).toEqual({ reason: "complete", files: 3, lines: 4 });
	});

	test("the line limit stops the search and says so", async () => {
		const { files, done } = await collect(root, query("repeat"));
		expect(done).toEqual({ reason: "limit", files: 1, lines: TEXT_SEARCH_LIMITS.lines });
		expect(files.get("many.txt")?.length).toBe(TEXT_SEARCH_LIMITS.lines);
	});

	test("case and whole-word flags reach git", async () => {
		const exact = await collect(root, query("Needle", { caseSensitive: true }));
		expect([...exact.files.keys()]).toEqual(["src/deep dir/spaced name.ts"]);
		expect(exact.files.get("src/deep dir/spaced name.ts")).toEqual([
			{ line: 1, column: 7, length: 6, text: "const Needle = 1;", ranges: [[6, 12]] },
		]);
		const words = await collect(root, query("needle", { wholeWord: true }));
		expect(words.files.get("tracked.txt")).toEqual([
			{ line: 1, column: 15, length: 6, text: "needles and a needle", ranges: [[14, 20]] },
		]);
		expect(words.done?.reason).toBe("complete");
	});

	test("no match completes empty; a folder that is not a repository is searched without git's index", async () => {
		const none = await collect(root, query("no-such-text-qq"));
		expect(none.done).toEqual({ reason: "complete", files: 0, lines: 0 });
		const folder = await collect(
			{ root: plain, projectId: "c", workspaceId: "c", git: false },
			query("needle"),
		);
		expect([...folder.files.keys()]).toEqual(["a.txt"]);
		expect(folder.done?.reason).toBe("complete");
	});

	test("an aborted search emits nothing more", async () => {
		const controller = new AbortController();
		const batches: Omit<TextSearchBatch, "seq">[] = [];
		const running = searchText(
			root,
			query("needle"),
			(batch) => batches.push(batch),
			controller.signal,
		);
		controller.abort();
		await running;
		expect(batches.some((batch) => batch.done)).toBe(false);
	});
});

describe("SearchService.text", () => {
	test("a newer seq supersedes the older search per client; no root completes empty", async () => {
		const dir = mkdtempSync(join(tmpdir(), "thinkrail-text-svc-"));
		try {
			Bun.spawnSync(["git", "-C", dir, "init", "-q", "-b", "main"]);
			writeFileSync(join(dir, "a.txt"), "needle\n");
			Bun.spawnSync(["git", "-C", dir, "add", "a.txt"]);
			const project: Project = { id: "p", name: "P", path: dir, slug: "p", lastOpened: 1 };
			const workspace: Workspace = {
				id: "w",
				projectId: "p",
				name: "Default",
				kind: "default",
				branch: "main",
				worktreePath: dir,
				baseBranch: "main",
			};
			const service = createSearchService({
				projects: () => [project],
				workspaces: () => [workspace],
				sessions: async () => ({ sessions: [], indexing: false }),
				specs: () => ({ entries: [], rebuilding: false }),
				plans: () => [],
				invalidateSpecs: () => {},
				stat: () => 1,
			});
			const seen: TextSearchBatch[] = [];
			const done = new Promise<void>((resolve) => {
				const params = {
					query: "needle",
					context: { projectId: "p", workspaceId: "w" },
					caseSensitive: false,
					wholeWord: false,
				};
				expect(
					service.text("c1", { ...params, seq: 2 }, (batch) => {
						seen.push(batch);
						if (batch.done) resolve();
					}),
				).toEqual({ seq: 2 });
				expect(service.text("c1", { ...params, seq: 1 }, (batch) => seen.push(batch))).toEqual({
					seq: 1,
					superseded: true,
				});
			});
			await done;
			expect(seen.every((batch) => batch.seq === 2)).toBe(true);
			expect(seen.every((batch) => batch.root?.workspaceId === "w")).toBe(true);
			expect(seen.flatMap((batch) => batch.files.map((file) => file.path))).toEqual(["a.txt"]);

			const empty: TextSearchBatch[] = [];
			service.text(
				"c2",
				{ seq: 1, query: "needle", context: {}, caseSensitive: false, wholeWord: false },
				(batch) => empty.push(batch),
			);
			expect(empty).toEqual([
				{ seq: 1, files: [], done: { reason: "complete", files: 0, lines: 0 } },
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
