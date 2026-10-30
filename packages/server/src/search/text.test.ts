import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, TextSearchBatch, TextSearchMatch, Workspace } from "@thinkrail/contracts";
import { TEXT_SEARCH_LIMITS } from "@thinkrail/contracts";
import { observeLoggedErrors } from "../log";
import type { SearchRoot } from "./providers";
import { createSearchService } from "./service";
import {
	caseVariantsPattern,
	cutLine,
	grepRecords,
	matchRanges,
	searchText,
	type TextQuery,
} from "./text";

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
	test("records split on NUL and newline, across chunks, with CRLF trimmed; a path may hold a newline", async () => {
		const records = [];
		for await (const record of grepRecords(
			chunks(
				"a b.ts\u00003\u0000hello wor",
				"ld\r\nc.md\u000012\u0000x\none\ntwo",
				".txt\u00002\u0000needle\n",
			),
		)) {
			records.push(record);
		}
		expect(records).toEqual([
			{ path: "a b.ts", line: 3, text: "hello world" },
			{ path: "c.md", line: 12, text: "x" },
			{ path: "one\ntwo.txt", line: 2, text: "needle" },
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
		expect(matchRanges("a... x", query("..", { wholeWord: true }))).toEqual([[2, 4]]);
		expect(matchRanges("foo()()()", query("()()", { wholeWord: true }))).toEqual([[5, 9]]);
		expect(matchRanges("İstanbul needle", query("needle"))).toEqual([[9, 15]]);
		expect(matchRanges("Äpfel und äpfel", query("äpfel"))).toEqual([
			[0, 5],
			[10, 15],
		]);
		expect(matchRanges("Äpfel und äpfel", query("äpfel", { caseSensitive: true }))).toEqual([
			[10, 15],
		]);
		const long = `${"x".repeat(1000)}needle${"y".repeat(1000)}`;
		const cut = cutLine(long, [[1000, 1006]]);
		expect(cut.text.length).toBeLessThanOrEqual(TEXT_SEARCH_LIMITS.lineChars + 2);
		expect(cut.text.startsWith("…")).toBe(true);
		const [range] = cut.ranges;
		expect(range && cut.text.slice(range[0], range[1])).toBe("needle");
	});

	test("a case-insensitive query with a non-ASCII cased letter spells out each letter's case variants", () => {
		expect(caseVariantsPattern(query("äpfel"))).toBe("(ä|Ä)(p|P)(f|F)(e|E)(l|L)");
		expect(caseVariantsPattern(query("ä.b"))).toBe("(ä|Ä)\\.(b|B)");
		expect(caseVariantsPattern(query("straße"))).toBe("(s|S)(t|T)(r|R)(a|A)ß(e|E)");
		expect(caseVariantsPattern(query("\u212Aelvin"))).toBe("(\u212A|k|K)(e|E)(l|L)(v|V)(i|I)(n|N)");
		expect(caseVariantsPattern(query("a.b"))).toBeNull();
		expect(caseVariantsPattern(query("日本"))).toBeNull();
		expect(caseVariantsPattern(query("äpfel", { caseSensitive: true }))).toBeNull();
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
		writeFileSync(join(dir, "fruit.txt"), "Äpfel und Birnen\nПривет мир\nİstanbul kiwi\n");
		writeFileSync(join(dir, "long.txt"), `${"x".repeat(70_000)}mango\n`);
		mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
		writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "papaya\n");
		mkdirSync(join(dir, "src", "node_modules"), { recursive: true });
		writeFileSync(join(dir, "src", "node_modules", "inner.js"), "papaya\n");
		writeFileSync(join(dir, "visible.js"), "papaya\n");
		if (process.platform !== "win32") writeFileSync(join(dir, "one\ntwo.txt"), "guava\n");
		writeFileSync(join(plain, "a.txt"), "plain needle\n");
		writeFileSync(join(plain, ".gitignore"), "a.txt\n");
		mkdirSync(join(plain, "node_modules"), { recursive: true });
		writeFileSync(join(plain, "node_modules", "m.js"), "needle\n");
		writeFileSync(join(plain, "bin.dat"), Buffer.from([0, ...Buffer.from("needle\n")]));
		writeFileSync(join(plain, "big.txt"), `needle\n${"z".repeat(TEXT_SEARCH_LIMITS.fileBytes)}\n`);
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

	test("no match completes empty; a chat's folder is read without git, over the palette's file set", async () => {
		const none = await collect(root, query("no-such-text-qq"));
		expect(none.done).toEqual({ reason: "complete", files: 0, lines: 0 });
		const spawned: string[][] = [];
		const realSpawn = Bun.spawn;
		(Bun as { spawn: typeof Bun.spawn }).spawn = ((argv: unknown, options?: unknown) => {
			if (Array.isArray(argv)) spawned.push(argv.map(String));
			return (realSpawn as (a: unknown, o?: unknown) => ReturnType<typeof Bun.spawn>)(
				argv,
				options,
			);
		}) as typeof Bun.spawn;
		try {
			const folder = await collect(
				{ root: plain, projectId: "c", workspaceId: "c", git: false },
				query("needle"),
			);
			expect([...folder.files.keys()]).toEqual(["a.txt"]);
			expect(folder.files.get("a.txt")).toEqual([
				{ line: 1, column: 7, length: 6, text: "plain needle", ranges: [[6, 12]] },
			]);
			expect(folder.done).toEqual({ reason: "complete", files: 1, lines: 1 });
		} finally {
			(Bun as { spawn: typeof Bun.spawn }).spawn = realSpawn;
		}
		expect(spawned).toEqual([]);
	});

	test("matches git reports are never dropped: non-ASCII case, a long line, a newline in a name", async () => {
		const apples = await collect(root, query("äpfel"));
		expect(apples.files.get("fruit.txt")?.map((match) => match.line)).toEqual([1]);
		const hello = await collect(root, query("привет"));
		expect(hello.files.get("fruit.txt")?.map((match) => match.column)).toEqual([1]);
		const kiwi = await collect(root, query("kiwi"));
		expect(kiwi.files.get("fruit.txt")).toEqual([
			{ line: 3, column: 10, length: 4, text: "İstanbul kiwi", ranges: [[9, 13]] },
		]);
		const mango = await collect(root, query("mango"));
		expect(mango.files.get("long.txt")?.map((match) => [match.line, match.column])).toEqual([
			[1, 70_001],
		]);
		if (process.platform !== "win32") {
			const guava = await collect(root, query("guava"));
			expect([...guava.files.keys()]).toEqual(["one\ntwo.txt"]);
		}
	});

	test("node_modules and VCS folders stay hidden, as in the palette's file list", async () => {
		const { files } = await collect(root, query("papaya"));
		expect([...files.keys()]).toEqual(["visible.js"]);
	});

	test("user git config that reshapes grep's output changes nothing", async () => {
		const config = (...args: string[]) =>
			Bun.spawnSync(["git", "-C", dir, "config", ...args], { stdout: "ignore", stderr: "ignore" });
		config("grep.column", "true");
		config("grep.fullName", "true");
		try {
			const { files } = await collect({ ...root, root: join(dir, "src") }, query("needle"));
			expect([...files.keys()].sort()).toEqual(["deep dir/spaced name.ts", "ünïcode.md"]);
			expect(
				files.get("deep dir/spaced name.ts")?.map((match) => [match.line, match.column]),
			).toEqual([
				[1, 7],
				[2, 1],
			]);
		} finally {
			config("--unset", "grep.column");
			config("--unset", "grep.fullName");
		}
	});

	test("a search git could not run ends failed and is reported with its code", async () => {
		const seen: unknown[] = [];
		observeLoggedErrors((_scope, error) => seen.push(error));
		try {
			const { files, done } = await collect(
				{ ...root, root: join(dir, "no-such-folder") },
				query("needle"),
			);
			expect(files.size).toBe(0);
			expect(done).toEqual({ reason: "failed", files: 0, lines: 0 });
		} finally {
			observeLoggedErrors(null);
		}
		expect(seen).toEqual([expect.objectContaining({ code: "TEXT_SEARCH_FAILED" })]);
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
	test("a chat's folder is listed afresh for every search, so a file written since is found", async () => {
		const folder = mkdtempSync(join(tmpdir(), "thinkrail-text-chat-"));
		try {
			writeFileSync(join(folder, "a.txt"), "needle\n");
			const container: Project = {
				id: "chats",
				name: "Chats",
				path: tmpdir(),
				slug: "chats",
				lastOpened: 1,
				kind: "chats",
			};
			const chat: Workspace = {
				id: "c",
				projectId: "chats",
				name: "Chat",
				kind: "chat",
				branch: "",
				worktreePath: folder,
				baseBranch: "",
			};
			const service = createSearchService({
				projects: () => [container],
				workspaces: () => [chat],
				sessions: async () => ({ sessions: [], indexing: false }),
				specs: () => ({ entries: [], rebuilding: false }),
				sections: () => ({ hits: [], total: 0, indexing: false }),
				plans: () => [],
				invalidateSpecs: () => {},
				stat: () => 1,
			});
			const search = (seq: number) =>
				new Promise<string[]>((resolve) => {
					const paths: string[] = [];
					service.text(
						"c1",
						{
							seq,
							query: "needle",
							context: { workspaceId: "c" },
							caseSensitive: false,
							wholeWord: false,
						},
						(batch) => {
							paths.push(...batch.files.map((file) => file.path));
							if (batch.done) resolve(paths.sort());
						},
					);
				});
			expect(await search(1)).toEqual(["a.txt"]);
			writeFileSync(join(folder, "b.txt"), "a needle too\n");
			expect(await search(2)).toEqual(["a.txt", "b.txt"]);
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	});

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
				sections: () => ({ hits: [], total: 0, indexing: false }),
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
