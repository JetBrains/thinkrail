import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, SearchHit, Workspace } from "@thinkrail/contracts";
import { MATCH_TIER } from "@thinkrail/contracts";
import { indexSections, searchSpecs } from "pi-spec-graph/core";
import type { HistorySession } from "../history";
import type { SpecSectionHit, SpecSections, SpecSnapshotEntry } from "../spec";
import type { StoredPlanFile } from "../todos";
import {
	FILE_LIST_LIMITS,
	type FileList,
	FileListCache,
	listRootFiles,
	parseNulList,
	walkFileList,
} from "./files";
import { searchFiles, searchTranscripts } from "./providers";
import { createSearchService, resolveSearchRoot, type SearchReaders } from "./service";

const encoder = new TextEncoder();

const pathOf = (hit: SearchHit) => ("path" in hit ? hit.path : undefined);
const sizeOf = (hit: SearchHit) => ("size" in hit ? hit.size : undefined);
const messageOf = (hit: SearchHit) =>
	hit.kind === "transcript" ? [hit.sessionId, hit.messageIndex] : [];

function chunks(...parts: string[]): Uint8Array[] {
	return parts.map((part) => encoder.encode(part));
}

describe("parseNulList", () => {
	test("splits NUL-separated names across chunk boundaries and keeps a trailing unterminated name", async () => {
		const list = await parseNulList(chunks("a.ts\0src/b", ".ts\0", "odd name\0last"));
		expect(list).toEqual({ paths: ["a.ts", "src/b.ts", "odd name", "last"], truncated: false });
	});

	test("caps the number of entries and the bytes read, and a list exactly at the cap is complete", async () => {
		const limits = { maxFiles: 2, maxBytes: 1_000 };
		const capped = await parseNulList(chunks("a\0b\0c\0d\0"), limits);
		expect(capped).toEqual({ paths: ["a", "b"], truncated: true });
		expect(await parseNulList(chunks("a\0b\0"), limits)).toEqual({
			paths: ["a", "b"],
			truncated: false,
		});
		expect(await parseNulList(chunks("a\0b\0c"), limits)).toEqual({
			paths: ["a", "b"],
			truncated: true,
		});
		expect(await parseNulList(chunks("a\0a\0node_modules/x\0b\0b\0"), limits)).toEqual({
			paths: ["a", "b"],
			truncated: false,
		});
		const bytes = await parseNulList(chunks("a\0", "b\0", "c\0"), { maxFiles: 10, maxBytes: 3 });
		expect(bytes).toEqual({ paths: ["a"], truncated: true });
	});
});

describe("listRootFiles", () => {
	let dir: string;
	let plain: string;
	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "thinkrail-search-"));
		plain = mkdtempSync(join(tmpdir(), "thinkrail-search-plain-"));
		const git = (...args: string[]) => {
			const result = Bun.spawnSync(["git", "-C", dir, ...args], {
				stdout: "ignore",
				stderr: "ignore",
			});
			if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
		};
		git("init", "-q", "-b", "main");
		mkdirSync(join(dir, "src", "deep dir"), { recursive: true });
		writeFileSync(join(dir, "src", "deep dir", "spaced name.ts"), "x");
		writeFileSync(join(dir, "src", "ünïcode.md"), "x");
		writeFileSync(join(dir, "tracked.txt"), "x");
		writeFileSync(join(dir, ".gitignore"), "ignored.log\n");
		writeFileSync(join(dir, "ignored.log"), "x");
		git("add", "tracked.txt");
		mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
		writeFileSync(join(dir, "node_modules", "dep", "index.js"), "x");
		mkdirSync(join(plain, "node_modules", "dep"), { recursive: true });
		writeFileSync(join(plain, "node_modules", "dep", "index.js"), "x");
		writeFileSync(join(plain, "a.txt"), "x");
	});
	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
		rmSync(plain, { recursive: true, force: true });
	});

	test("a git root lists tracked and untracked files with odd names, never ignored ones or node_modules", async () => {
		const list = await listRootFiles(dir, true);
		expect(list.truncated).toBe(false);
		expect([...list.paths].sort()).toEqual([
			".gitignore",
			"src/deep dir/spaced name.ts",
			"src/ünïcode.md",
			"tracked.txt",
		]);
	});

	test("a chat's folder is walked, never asked of git: ignored files are listed, VCS folders and node_modules never", async () => {
		expect([...(await listRootFiles(dir, false)).paths].sort()).toEqual([
			".gitignore",
			"ignored.log",
			"src/deep dir/spaced name.ts",
			"src/ünïcode.md",
			"tracked.txt",
		]);
		expect(await listRootFiles(plain, false)).toEqual({ paths: ["a.txt"], truncated: false });
	});

	test("a folder git refuses fails the load instead of answering a partial list", async () => {
		await expect(listRootFiles(plain, true)).rejects.toThrow("git ls-files failed");
	});

	test("a path git lists once per conflict stage is listed once", async () => {
		const repo = mkdtempSync(join(tmpdir(), "thinkrail-search-conflict-"));
		const git = (...args: string[]) =>
			Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
				stdout: "ignore",
				stderr: "ignore",
			});
		try {
			git("init", "-q", "-b", "main");
			writeFileSync(join(repo, "conflict.txt"), "base\n");
			git("add", "conflict.txt");
			git("commit", "-q", "-m", "base");
			git("checkout", "-q", "-b", "other");
			writeFileSync(join(repo, "conflict.txt"), "other\n");
			git("commit", "-q", "-am", "other");
			git("checkout", "-q", "main");
			writeFileSync(join(repo, "conflict.txt"), "main\n");
			git("commit", "-q", "-am", "main");
			git("merge", "-q", "other");
			expect((await listRootFiles(repo, true)).paths).toEqual(["conflict.txt"]);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});

describe("walkFileList", () => {
	const entry = (name: string, directory = false) => ({
		name,
		isDirectory: () => directory,
		isFile: () => !directory,
	});
	const failure = (code: string) => Object.assign(new Error(code), { code });

	test("a folder that vanished or cannot be read is skipped; the root's own failure or any other one fails the load", async () => {
		const tree: Record<string, () => ReturnType<typeof entry>[]> = {
			"/c": () => [
				entry("gone", true),
				entry("locked", true),
				entry("replaced", true),
				entry("denied", true),
				entry("a.md"),
				entry("deep", true),
			],
			"/c/gone": () => {
				throw failure("ENOENT");
			},
			"/c/locked": () => {
				throw failure("EACCES");
			},
			"/c/replaced": () => {
				throw failure("ENOTDIR");
			},
			"/c/denied": () => {
				throw failure("EPERM");
			},
			"/c/deep": () => [entry("b.md"), entry(".git", true), entry("node_modules", true)],
		};
		const read = async (path: string) => (tree[path] ?? (() => []))();
		expect(await walkFileList("/c", read)).toEqual({
			paths: ["a.md", "deep/b.md"],
			truncated: false,
		});
		await expect(
			walkFileList("/c", async (path) => {
				if (path === "/c") throw failure("ENOENT");
				return [];
			}),
		).rejects.toThrow("the folder could not be walked (ENOENT)");
		await expect(
			walkFileList("/c", async (path) => {
				if (path === "/c/deep") throw failure("EMFILE");
				return path === "/c" ? [entry("deep", true)] : [];
			}),
		).rejects.toThrow("the folder could not be walked (EMFILE)");
	});

	test("caps the files it lists, and a folder of exactly the cap is complete", async () => {
		const files = (count: number) => async () =>
			Array.from({ length: count }, (_, index) => entry(`f-${index}.md`));
		const cap = FILE_LIST_LIMITS.walkMaxFiles;
		const exact = await walkFileList("/c", files(cap));
		expect(exact.truncated).toBe(false);
		expect(exact.paths).toHaveLength(cap);
		const over = await walkFileList("/c", files(cap + 1));
		expect(over.truncated).toBe(true);
		expect(over.paths).toHaveLength(cap);
	});
});

describe("chat providers", () => {
	const label = () => ({ projectId: "p1", workspaceId: "w1" });
	const budget = (checks: number) => {
		let used = 0;
		return {
			expired: () => {
				used += 1;
				return used > checks;
			},
		};
	};
	const session = (id: string, title: string, at: number, texts: string[]): HistorySession => ({
		sessionId: id,
		cwd: "/repos/one",
		title,
		entries: texts.map((text, index) => ({
			role: "user",
			text,
			timestamp: at + index,
			messageIndex: index,
			entryId: `${id}-${index}`,
		})),
	});
	const input = (query: string, checks: number) => ({
		text: query,
		terms: [{ text: query, literal: false }],
		limit: 20,
		deadline: budget(checks),
	});
	const old = session("old", "Token refresh, the long one", 1_000, Array(500).fill("refresh"));
	const recent = session("recent", "Quantum banana", 9_000, ["refresh the cache"]);

	test("a budget that runs out leaves older messages unsearched, never the newest chat's", () => {
		const group = searchTranscripts([old, recent], "ready", label, input("refresh", 3));
		expect(group).toMatchObject({ state: "ready", cut: { time: true } });
		expect(group.hits.map(messageOf)).toEqual([
			["recent", 0],
			["old", 499],
			["old", 498],
		]);
	});

	test("a transcript hit keeps its id when compaction shifts its message's index", () => {
		const at = (shift: number): HistorySession => ({
			sessionId: "s",
			cwd: "/repos/one",
			title: "Compacted",
			entries: [
				{
					role: "user",
					text: "a refresh",
					timestamp: 100,
					messageIndex: 2 - shift,
					entryId: "e-a",
				},
				{
					role: "assistant",
					text: "b refresh",
					timestamp: 200,
					messageIndex: 3 - shift,
					entryId: "e-b",
				},
			],
		});
		const byMessage = (session: HistorySession) =>
			Object.fromEntries(
				searchTranscripts([session], "ready", label, input("refresh", 10)).hits.map((hit) =>
					hit.kind === "transcript" ? [hit.anchorText, [hit.id, hit.messageIndex]] : [],
				),
			);
		const before = byMessage(at(0));
		const after = byMessage(at(1));
		expect(after["a refresh"]?.[0]).toBe(before["a refresh"]?.[0]);
		expect(after["b refresh"]?.[0]).toBe(before["b refresh"]?.[0]);
		expect([before["b refresh"]?.[1], after["b refresh"]?.[1]]).toEqual([3, 2]);
	});

	test("messages queued in the same millisecond keep distinct ids, their pi entries'", () => {
		const queued: HistorySession = {
			sessionId: "q",
			cwd: "/repos/one",
			title: "Queued",
			entries: ["first refresh", "second refresh", "third refresh"].map((text, index) => ({
				role: "user",
				text,
				timestamp: 500,
				messageIndex: index,
				entryId: `entry-${index}`,
			})),
		};
		const ids = searchTranscripts([queued], "ready", label, input("refresh", 10)).hits.map(
			(hit) => hit.id,
		);
		expect(ids.sort()).toEqual([
			"transcript:q:entry-0",
			"transcript:q:entry-1",
			"transcript:q:entry-2",
		]);
	});
});

describe("FileListCache", () => {
	function deferredLoader() {
		const pending: ((list: FileList) => void)[] = [];
		let loads = 0;
		const loader = () =>
			new Promise<FileList>((resolve) => {
				loads += 1;
				pending.push(resolve);
			});
		return {
			loader,
			loads: () => loads,
			finish: (paths: string[]) => pending.shift()?.({ paths, truncated: false }),
		};
	}

	test("a change during a reload leaves the reloaded list stale, so the next ask reloads", async () => {
		const deferred = deferredLoader();
		const files = new FileListCache(deferred.loader);
		const cold = files.load("/r", true);
		deferred.finish(["a.ts"]);
		await cold;
		files.invalidate("/r");
		expect(files.peek("/r", true)).toMatchObject({
			list: { paths: ["a.ts"] },
			state: "refreshing",
		});
		files.invalidate("/r");
		deferred.finish(["a.ts", "b.ts"]);
		await Bun.sleep(0);
		expect(files.peek("/r", true)).toMatchObject({
			list: { paths: ["a.ts", "b.ts"] },
			state: "refreshing",
		});
		deferred.finish(["a.ts", "b.ts", "c.ts"]);
		await Bun.sleep(0);
		expect(files.peek("/r", true)).toMatchObject({
			list: { paths: ["a.ts", "b.ts", "c.ts"] },
			state: "ready",
		});
		expect(deferred.loads()).toBe(3);
	});

	test("a change during the first load leaves it stale too", async () => {
		const deferred = deferredLoader();
		const files = new FileListCache(deferred.loader);
		const cold = files.load("/r", true);
		files.invalidate("/r");
		deferred.finish(["a.ts"]);
		await cold;
		expect(files.peek("/r", true)).toMatchObject({
			list: { paths: ["a.ts"] },
			state: "refreshing",
		});
	});

	test("a file git still lists but the worktree deleted is neither a hit nor counted", async () => {
		const files = new FileListCache(async () => ({
			paths: ["a-gone.ts", "b-here.ts", "c-here.ts"],
			truncated: false,
		}));
		await files.load("/r", true);
		const group = searchFiles(
			{ root: "/r", projectId: "p1", workspaceId: "w1", git: true },
			files,
			{
				text: "ts",
				terms: [{ text: "ts", literal: false }],
				limit: 2,
				deadline: { expired: () => false },
			},
			(_root, path) => (path === "a-gone.ts" ? "missing" : path === "c-here.ts" ? null : 3),
		);
		expect(group.hits.map((hit) => [pathOf(hit), sizeOf(hit)])).toEqual([
			["b-here.ts", 3],
			["c-here.ts", undefined],
		]);
		expect(group.total).toBe(2);
	});

	test("checking for deleted files stops at the budget and answers what it verified as truncated", async () => {
		const files = new FileListCache(async () => ({
			paths: Array.from({ length: 50 }, (_, index) => `gone-${index}.ts`),
			truncated: false,
		}));
		await files.load("/r", true);
		let checks = 0;
		const group = searchFiles(
			{ root: "/r", projectId: "p1", workspaceId: "w1", git: true },
			files,
			{
				text: "gone",
				terms: [{ text: "gone", literal: false }],
				limit: 20,
				deadline: { expired: () => checks >= 5 },
			},
			() => {
				checks += 1;
				return "missing";
			},
		);
		expect(checks).toBe(5);
		expect(group).toMatchObject({ state: "ready", cut: { time: true }, hits: [] });
	});

	test("a scan that ran out of time still answers the matches it found", async () => {
		const files = new FileListCache(async () => ({
			paths: Array.from({ length: 1_500 }, (_, index) => `keep-${index}.ts`),
			truncated: false,
		}));
		await files.load("/r", true);
		const group = searchFiles(
			{ root: "/r", projectId: "p1", workspaceId: "w1", git: true },
			files,
			{
				text: "keep",
				terms: [{ text: "keep", literal: false }],
				limit: 20,
				deadline: { expired: () => true },
			},
			() => 1,
		);
		expect(group).toMatchObject({ state: "ready", cut: { time: true } });
		expect(group.hits).toHaveLength(20);
	});

	test("a file hit carries the size the injected stat reports for its root and path, so the client can decline to preview a large one", async () => {
		const files = new FileListCache(async () => ({
			paths: ["big.log", "outside-link.log"],
			truncated: false,
		}));
		await files.load("/r", true);
		const asked: string[] = [];
		const group = searchFiles(
			{ root: "/r", projectId: "p1", workspaceId: "w1", git: true },
			files,
			{
				text: "log",
				terms: [{ text: "log", literal: false }],
				limit: 20,
				deadline: { expired: () => false },
			},
			(root, path) => {
				asked.push(`${root}|${path}`);
				return path === "big.log" ? 4096 : "missing";
			},
		);
		expect(asked).toEqual(["/r|big.log", "/r|outside-link.log"]);
		expect(group.hits.map((hit) => [pathOf(hit), sizeOf(hit)])).toEqual([["big.log", 4096]]);
		expect(group.total).toBe(1);
	});

	test("a chat's root is walked on every load, a refresh after the TTL included, and a repository's is asked of git", async () => {
		let now = 0;
		const modes: string[] = [];
		const files = new FileListCache(
			async (root, git) => {
				modes.push(`${root}:${git ? "git" : "walk"}`);
				return { paths: ["notes.md"], truncated: false };
			},
			() => now,
		);
		const input = {
			text: "notes",
			terms: [{ text: "notes", literal: false }],
			limit: 20,
			deadline: { expired: () => false },
		};
		const chat = { root: "/chat", projectId: "c", workspaceId: "w-chat", git: false };
		const repo = { root: "/r", projectId: "p1", workspaceId: "w1", git: true };
		searchFiles(chat, files, input, () => 1);
		searchFiles(repo, files, input, () => 1);
		await Bun.sleep(0);
		now += FILE_LIST_LIMITS.ttlMs + 1;
		expect(searchFiles(chat, files, input, () => 1).hits.map(pathOf)).toEqual(["notes.md"]);
		await Bun.sleep(0);
		expect(modes).toEqual(["/chat:walk", "/r:git", "/chat:walk"]);
	});

	test("a failed load answers failed with the last good list and is retried only after the retry interval", async () => {
		let fail = true;
		let clock = 0;
		let loads = 0;
		const files = new FileListCache(
			async () => {
				loads += 1;
				if (fail) throw new Error("EMFILE");
				return { paths: ["src/refresh.ts"], truncated: false };
			},
			() => clock,
		);
		const root = { root: "/r", projectId: "p1", workspaceId: "w1", git: true };
		const input = (query: string) => ({
			text: query,
			terms: [{ text: query, literal: false }],
			limit: 20,
			deadline: { expired: () => false },
		});
		const present = () => 1;
		await files.load("/r", true);
		fail = false;
		clock = 4_000;
		expect(searchFiles(root, files, input("refresh"), present)).toMatchObject({
			state: "failed",
			hits: [],
		});
		await Bun.sleep(0);
		expect(loads).toBe(1);
		clock = 5_000;
		files.peek("/r", true);
		await Bun.sleep(0);
		expect(searchFiles(root, files, input("refresh"), present)).toMatchObject({ state: "ready" });
		expect(searchFiles(root, files, input("refresh"), present).hits.map(pathOf)).toEqual([
			"src/refresh.ts",
		]);

		fail = true;
		files.invalidate("/r");
		files.peek("/r", true);
		await Bun.sleep(0);
		const stale = searchFiles(root, files, input("refresh"), present);
		expect(stale.state).toBe("failed");
		expect(stale.hits.map(pathOf)).toEqual(["src/refresh.ts"]);
		files.invalidate("/r");
		clock = 6_000;
		files.peek("/r", true);
		await Bun.sleep(0);
		expect(loads).toBe(3);
	});

	test("a root whose load failed keeps its retry interval when its list is evicted", async () => {
		let clock = 0;
		let loads = 0;
		const files = new FileListCache(
			async () => {
				loads += 1;
				throw new Error("EMFILE");
			},
			() => clock,
		);
		for (let index = 0; index < 9; index += 1) await files.load(`/root-${index}`, true);
		expect(loads).toBe(9);
		expect(files.peek("/root-0", true)).toMatchObject({ state: "failed", list: { paths: [] } });
		await Bun.sleep(0);
		expect(loads).toBe(9);
		clock = 5_000;
		files.peek("/root-0", true);
		await Bun.sleep(0);
		expect(loads).toBe(10);
	});

	test("cached lists are bounded by count and by the paths they hold together", async () => {
		const big = Array.from({ length: 100_000 }, (_, index) => `f-${index}.ts`);
		const files = new FileListCache(async () => ({ paths: big, truncated: false }));
		for (const root of ["/a", "/b", "/c"]) await files.load(root, true);
		expect(files.peek("/a", true)).toBeNull();
		expect(files.peek("/b", true)?.list.paths).toHaveLength(100_000);
		expect(files.peek("/c", true)?.list.paths).toHaveLength(100_000);
	});
});

const project: Project = { id: "p1", name: "One", path: "/repos/one", slug: "one", lastOpened: 1 };
const other: Project = { id: "p2", name: "Two", path: "/repos/two", slug: "two", lastOpened: 0 };
const defaultOne: Workspace = {
	id: "w-default",
	projectId: "p1",
	kind: "default",
	name: "Default",
	branch: "main",
	worktreePath: "/repos/one",
	baseBranch: "main",
};
const feature: Workspace = {
	id: "w-feature",
	projectId: "p1",
	name: "Auth refresh",
	branch: "auth-refresh",
	worktreePath: "/repos/one-auth",
	baseBranch: "main",
	review: { kind: "pull-request", number: 42, state: "open" },
	lastActiveAt: 5,
};
const closedProjectWorkspace: Workspace = {
	id: "w-closed",
	projectId: "p-closed",
	name: "Old",
	branch: "old",
	worktreePath: "/repos/closed",
	baseBranch: "main",
};

describe("resolveSearchRoot", () => {
	test("the active worktree is the root; Project Home falls back to the context project's folder through its Default record", () => {
		expect(
			resolveSearchRoot([project, other], [defaultOne, feature], {
				projectId: "p1",
				workspaceId: "w-feature",
			}),
		).toEqual({ root: "/repos/one-auth", projectId: "p1", workspaceId: "w-feature", git: true });
		expect(resolveSearchRoot([other, project], [defaultOne], { projectId: "p1" })).toEqual({
			root: "/repos/one",
			projectId: "p1",
			workspaceId: "w-default",
			git: true,
		});
		const chats: Project = { ...other, id: "c", path: "/data/chats", kind: "chats" };
		const chat: Workspace = {
			...feature,
			id: "w-chat",
			projectId: "c",
			kind: "chat",
			worktreePath: "/data/chats/2026-10-26-ab12cd",
		};
		expect(resolveSearchRoot([chats], [chat], { projectId: "c", workspaceId: "w-chat" })).toEqual({
			root: "/data/chats/2026-10-26-ab12cd",
			projectId: "c",
			workspaceId: "w-chat",
			git: false,
		});
		expect(resolveSearchRoot([chats], [chat], { projectId: "c" })).toBeNull();
	});

	test("no root without a context project, a closed project, or a project whose Default record is not known yet", () => {
		expect(resolveSearchRoot([project], [defaultOne], {})).toBeNull();
		expect(
			resolveSearchRoot([project], [closedProjectWorkspace], { workspaceId: "w-closed" }),
		).toBeNull();
		expect(resolveSearchRoot([other], [], { projectId: "p2" })).toBeNull();
	});
});

const sessions: HistorySession[] = [
	{
		sessionId: "s1",
		cwd: "/repos/one-auth",
		title: "Fix auth token refresh",
		entries: [
			{
				role: "user",
				text: "please refresh the token flow",
				timestamp: 10,
				messageIndex: 0,
				entryId: "m0",
			},
			{
				role: "assistant",
				text: "Done: the refresh now retries once.",
				timestamp: 11,
				messageIndex: 1,
				entryId: "m1",
			},
		],
	},
	{
		sessionId: "s2",
		cwd: "/repos/one",
		title: "Billing redesign",
		entries: [
			{ role: "user", text: "billing page", timestamp: 20, messageIndex: 0, entryId: "b0" },
		],
	},
	{
		sessionId: "s-cli",
		cwd: "/somewhere/else",
		title: "Refresh notes",
		entries: [{ role: "user", text: "refresh", timestamp: 30, messageIndex: 0, entryId: "c0" }],
	},
];

const specs: Record<string, SpecSnapshotEntry[]> = {
	"/repos/one-auth": [
		{
			path: "SPEC.md",
			id: "root",
			title: "Root",
			type: "goal-and-requirements",
			content: "# Root\n\nThe auth refresh lives in the token module.\n",
		},
		{ path: "auth/SPEC.md", id: "auth", title: "Auth module", type: "module-design", content: "x" },
	],
};

const sectionHit: SpecSectionHit = {
	path: "SPEC.md",
	id: "root",
	title: "Root",
	type: "goal-and-requirements",
	heading: "Tokens › Refresh",
	occurrence: 1,
	line: 3,
	endLine: 4,
	snippet: "The auth refresh lives in the token module.",
	snippetLine: 4,
	ranges: { title: [], heading: [[9, 16]], snippet: [[9, 16]] },
	score: 2.5,
	matched: 1,
	terms: 1,
};

const sectionQueries: { root: string; query: string; limit: number }[] = [];

function sections(root: string): SpecSections {
	return {
		built: true,
		rebuilding: null,
		search: (query, limit) => {
			sectionQueries.push({ root, query, limit });
			const hits = root === "/repos/one-auth" && query.includes("refresh") ? [sectionHit] : [];
			return { hits, total: hits.length };
		},
	};
}

const plans: Record<string, StoredPlanFile[]> = {
	"/repos/one-auth": [
		{
			sessionId: "s1",
			path: "/repos/one-auth/.thinkrail/context/todos/s1.json",
			read: () => ({
				todos: [],
				groups: [
					{
						id: "g1",
						title: "Auth refresh plan",
						todos: [
							{
								id: "t1",
								title: "Refresh the token",
								status: "done",
								origin: "agent",
								createdAt: "",
								updatedAt: "",
							},
						],
					},
				],
			}),
		},
		{
			sessionId: "orphan",
			path: "/repos/one-auth/.thinkrail/context/todos/orphan.json",
			read: () => ({
				todos: [
					{
						id: "t9",
						title: "Refresh orphan",
						status: "pending",
						origin: "agent",
						createdAt: "",
						updatedAt: "",
					},
				],
				groups: [],
			}),
		},
	],
};

function readers(overrides: Partial<SearchReaders> = {}): SearchReaders {
	return {
		projects: () => [project, other],
		workspaces: () => [defaultOne, feature, closedProjectWorkspace],
		sessions: async () => ({ sessions, state: "ready" }),
		specs: (root) => ({ entries: specs[root] ?? [], built: true, rebuilding: null }),
		sections,
		plans: (root) => plans[root] ?? [],
		invalidateSpecs: () => {},
		ensureDefault: async () => [],
		watchRoot: () => {},
		stat: () => 1,
		isText: () => true,
		...overrides,
	};
}

const lists: Record<string, FileList> = {
	"/repos/one-auth": {
		paths: ["src/auth/refresh.ts", "src/billing/index.ts", "README.md"],
		truncated: false,
	},
	"/repos/one": { paths: ["src/auth/refresh.ts", "docs/refresh-notes.md"], truncated: false },
	"/repos/two": { paths: ["other.txt"], truncated: false },
};

const context = { projectId: "p1", workspaceId: "w-feature" };

describe("search.query", () => {
	test("answers every kind for a typed query: files, specs and sections from the one root, transcripts and plans from the open projects", async () => {
		const files = new FileListCache(async (root) => lists[root] ?? { paths: [], truncated: false });
		await Promise.all(Object.keys(lists).map((root) => files.load(root, true)));
		const watched: string[] = [];
		const service = createSearchService(
			readers({ files, watchRoot: (workspaceId) => watched.push(workspaceId) }),
		);
		const result = await service.query({ query: "refresh", context });
		const byKind = Object.fromEntries(result.groups.map((group) => [group.kind, group]));
		expect(watched).toEqual(["w-feature"]);
		expect(JSON.stringify(result)).not.toContain("timestamp");

		expect(byKind.file?.hits.map((hit) => hit.id)).toEqual(["file:w-feature:src/auth/refresh.ts"]);
		expect(byKind.file?.hits[0]).toMatchObject({ projectId: "p1", workspaceId: "w-feature" });
		expect(byKind.spec?.hits).toEqual([]);
		expect(byKind.section).toEqual({
			kind: "section",
			hits: [
				{
					id: "section:w-feature:SPEC.md:Tokens › Refresh#1",
					kind: "section",
					title: "Root",
					subtitle: "SPEC.md",
					snippet: "The auth refresh lives in the token module.",
					tier: MATCH_TIER.content,
					score: 2.5,
					ranges: { title: [], heading: [[9, 16]], snippet: [[9, 16]] },
					projectId: "p1",
					workspaceId: "w-feature",
					path: "SPEC.md",
					specId: "root",
					section: { heading: "Tokens › Refresh", line: 3, matched: 1, terms: 1 },
				},
			],
			total: 1,
			state: "ready",
		});
		expect(sectionQueries.at(-1)).toEqual({ root: "/repos/one-auth", query: "refresh", limit: 20 });
		expect(byKind.transcript?.hits.map((hit) => hit.id)).toEqual([
			"transcript:s1:m1",
			"transcript:s1:m0",
		]);
		expect(byKind.transcript?.hits[1]).toMatchObject({
			messageIndex: 0,
			anchorText: "please refresh the token flow",
			tier: MATCH_TIER.content,
		});
		expect(byKind.plan?.hits.map((hit) => hit.id)).toEqual([
			"plan:w-feature:s1:t1",
			"plan:w-feature:s1:g1",
		]);
		expect(byKind.plan?.hits[0]).toMatchObject({ subtitle: "Auth refresh plan", sessionId: "s1" });
	});

	test("files fold case and diacritics like the matcher and a quoted term stays literal", async () => {
		const files = new FileListCache(async () => ({
			paths: ["docs/Café.md", "src/cafe/menu.ts", "src/FooBar.ts"],
			truncated: false,
		}));
		await files.load("/repos/one-auth", true);
		const service = createSearchService(readers({ files }));
		const paths = async (query: string) =>
			(await service.query({ query, kinds: ["file"], context })).groups[0]?.hits.map(pathOf).sort();
		expect(await paths("cafe")).toEqual(["docs/Café.md", "src/cafe/menu.ts"]);
		expect(await paths("CAFÉ")).toEqual(["docs/Café.md", "src/cafe/menu.ts"]);
		expect(await paths("fb")).toEqual(["src/FooBar.ts"]);
		expect(await paths('"fb"')).toEqual([]);
	});

	test("a quoted phrase is one term for transcripts", async () => {
		const service = createSearchService(
			readers({ files: new FileListCache(async () => ({ paths: [], truncated: false })) }),
		);
		const ids = async (query: string) =>
			(await service.query({ query, kinds: ["transcript"], context })).groups.flatMap((group) =>
				group.hits.map((hit) => hit.id),
			);
		expect(await ids("flow token")).toContain("transcript:s1:m0");
		expect(await ids('"token flow"')).toContain("transcript:s1:m0");
		expect(await ids('"flow token"')).toEqual([]);
	});

	test("message text and spec sections fold accents like titles do, in either spelling", async () => {
		const accented: HistorySession = {
			sessionId: "s-acc",
			cwd: "/repos/one-auth",
			title: "Accents",
			entries: [
				{
					role: "user",
					text: "la configuracio\u0301n del café",
					timestamp: 40,
					messageIndex: 0,
					entryId: "x0",
				},
			],
		};
		const service = createSearchService(
			readers({
				files: new FileListCache(async () => ({ paths: [], truncated: false })),
				sessions: async () => ({ sessions: [accented], state: "ready" }),
				sections: () => {
					const index = indexSections([
						{
							path: "SPEC.md",
							content: "---\nid: root\ntitle: Root\ntype: x\n---\n# Root\n\nЕщё одна ёлка.\n",
							frontmatter: { id: "root", title: "Root", type: "x" },
						},
					]);
					return {
						built: true,
						rebuilding: null,
						search: (query, limit) => searchSpecs(index, query, { limit }),
					};
				},
			}),
		);
		const ids = async (query: string) =>
			(await service.query({ query, kinds: ["transcript", "section"], context })).groups.flatMap(
				(group) => group.hits.map((hit) => hit.id),
			);
		expect(await ids("configuracion cafe")).toEqual(["transcript:s-acc:x0"]);
		expect(await ids("еще елка")).toEqual(["section:w-feature:SPEC.md:#1"]);
		expect(await ids("ЕЩЁ")).toEqual(["section:w-feature:SPEC.md:#1"]);
		const hit = (await service.query({ query: "configuración", kinds: ["transcript"], context }))
			.groups[0]?.hits[0];
		expect(hit?.ranges?.title).toEqual([[3, 17]]);
	});

	test("a plan whose session the history has not reached yet answers indexing, so it is asked again", async () => {
		const building = createSearchService(
			readers({
				files: new FileListCache(async () => ({ paths: [], truncated: false })),
				sessions: async () => ({ sessions: [], state: "cold" }),
			}),
		);
		const cold = await building.query({ query: "refresh", kinds: ["plan"], context });
		expect(cold.groups[0]).toMatchObject({ kind: "plan", state: "indexing", hits: [] });
		const built = createSearchService(
			readers({ files: new FileListCache(async () => ({ paths: [], truncated: false })) }),
		);
		const warm = await built.query({ query: "refresh", kinds: ["plan"], context });
		expect(warm.groups[0]?.state).toBe("ready");
		expect(warm.groups[0]?.hits.map((hit) => hit.id)).toContain("plan:w-feature:s1:t1");
	});

	test("an empty query answers empty groups and `kinds` narrows the providers", async () => {
		const service = createSearchService(
			readers({ files: new FileListCache(async () => lists["/repos/one"] as FileList) }),
		);
		const empty = await service.query({ query: "   ", context });
		expect(empty.groups.every((group) => group.hits.length === 0)).toBe(true);
		const narrowed = await service.query({
			query: "refresh",
			kinds: ["transcript"],
			context,
		});
		expect(narrowed.groups.map((group) => group.kind)).toEqual(["transcript"]);
	});

	test("a corpus that loads within the wait answers fresh at once; one slower than the wait answers what it has", async () => {
		let loads = 0;
		const quick = new FileListCache(async (root) => {
			loads += 1;
			return lists[root] ?? { paths: [], truncated: false };
		});
		const service = createSearchService(readers({ files: quick }));
		const cold = await service.query({ query: "refresh", kinds: ["file"], context });
		expect(cold.groups[0]).toMatchObject({ kind: "file", state: "ready" });
		expect(cold.groups[0]?.hits).toHaveLength(1);
		service.invalidateRoot("/repos/one-auth");
		const reloaded = await service.query({ query: "refresh", kinds: ["file"], context });
		expect(reloaded.groups[0]?.state).toBe("ready");
		expect(loads).toBe(2);

		const gate = Promise.withResolvers<void>();
		let slowLoads = 0;
		const slow = new FileListCache(async (root) => {
			slowLoads += 1;
			if (slowLoads > 1) await gate.promise;
			return lists[root] ?? { paths: [], truncated: false };
		});
		await slow.load("/repos/one-auth", true);
		const slowService = createSearchService(readers({ files: slow }));
		slowService.invalidateRoot("/repos/one-auth");
		const refreshing = await slowService.query({ query: "refresh", kinds: ["file"], context });
		expect(refreshing.groups[0]).toMatchObject({ state: "refreshing" });
		expect(refreshing.groups[0]?.hits).toHaveLength(1);
		gate.resolve();
		await Bun.sleep(0);
		const fresh = await slowService.query({ query: "refresh", kinds: ["file"], context });
		expect(fresh.groups[0]?.state).toBe("ready");
		expect(slow.peek("/repos/one", true)).toBeNull();
	});

	test("a cold corpus slower than the wait answers indexing; a spec snapshot or section index being rebuilt answers refreshing", async () => {
		const files = new FileListCache(() => new Promise<FileList>(() => {}));
		const service = createSearchService(
			readers({
				files,
				specs: (root) => ({
					entries: specs[root] ?? [],
					built: true,
					rebuilding: new Promise<void>(() => {}),
				}),
				sections: () => ({
					built: true,
					rebuilding: new Promise<void>(() => {}),
					search: () => ({ hits: [sectionHit], total: 1 }),
				}),
			}),
		);
		const result = await service.query({
			query: "auth",
			kinds: ["file", "spec", "section"],
			context,
		});
		expect(result.groups.map((group) => [group.kind, group.state])).toEqual([
			["file", "indexing"],
			["spec", "refreshing"],
			["section", "refreshing"],
		]);
		expect(result.groups[1]?.hits.map((hit) => hit.id)).toEqual(["spec:w-feature:auth/SPEC.md"]);
		expect(result.groups[2]?.hits).toHaveLength(1);
	});

	test("a failed reload answers failed with the last good hits, and a failed history read fails plans and messages", async () => {
		let fail = false;
		const files = new FileListCache(async (root) => {
			if (fail) throw new Error("EMFILE");
			return lists[root] ?? { paths: [], truncated: false };
		});
		await files.load("/repos/one-auth", true);
		fail = true;
		files.invalidate("/repos/one-auth");
		const service = createSearchService(
			readers({
				files,
				sessions: async () => {
					throw new Error("history unreadable");
				},
			}),
		);
		const result = await service.query({ query: "refresh", context });
		const byKind = Object.fromEntries(result.groups.map((group) => [group.kind, group]));
		expect(byKind.file).toMatchObject({ state: "failed" });
		expect(byKind.file?.hits).toHaveLength(1);
		expect(byKind.plan).toMatchObject({ state: "failed", hits: [] });
		expect(byKind.transcript).toMatchObject({ state: "failed", hits: [] });
	});

	test("an open project without its Default record yet gets it provisioned once and is searched; a failed provision fails the root", async () => {
		let records: Workspace[] = [];
		let ensured = 0;
		const files = new FileListCache(async (root) => lists[root] ?? { paths: [], truncated: false });
		const service = createSearchService(
			readers({
				files,
				workspaces: () => records,
				ensureDefault: async () => {
					ensured += 1;
					await Bun.sleep(1);
					records = [defaultOne];
				},
			}),
		);
		const home = { projectId: "p1" };
		const [first, second] = await Promise.all([
			service.query({ query: "refresh", kinds: ["file"], context: home }),
			service.query({ query: "refresh", kinds: ["file"], context: home }),
		]);
		expect(ensured).toBe(1);
		expect(first.groups[0]?.hits.map((hit) => hit.id).sort()).toEqual([
			"file:w-default:docs/refresh-notes.md",
			"file:w-default:src/auth/refresh.ts",
		]);
		expect(second.groups[0]?.state).toBe("ready");

		let clock = 0;
		let attempts = 0;
		const broken = createSearchService(
			readers({
				workspaces: () => [],
				wallClock: () => clock,
				ensureDefault: async () => {
					attempts += 1;
					throw new Error("folder gone");
				},
			}),
		);
		const failed = await broken.query({ query: "refresh", kinds: ["file", "spec"], context: home });
		expect(failed.groups.map((group) => group.state)).toEqual(["failed", "failed"]);
		clock = 4_000;
		await broken.query({ query: "refresh", kinds: ["file"], context: home });
		expect(attempts).toBe(1);
		clock = 5_000;
		await broken.query({ query: "refresh", kinds: ["file"], context: home });
		expect(attempts).toBe(2);
	});

	test("the file-list cache keeps a bounded number of roots, and no root answers empty file and spec groups", async () => {
		const files = new FileListCache(async () => ({ paths: ["a.ts"], truncated: false }));
		for (let index = 0; index < 10; index += 1) await files.load(`/root-${index}`, true);
		expect(files.peek("/root-0", true)).toBeNull();
		expect(files.peek("/root-9", true)).not.toBeNull();

		const service = createSearchService(readers({ files }));
		const homeless = await service.query({
			query: "refresh",
			kinds: ["file", "spec", "section"],
			context: {},
		});
		expect(homeless.groups).toEqual([
			{ kind: "file", hits: [], total: 0, state: "ready" },
			{ kind: "spec", hits: [], total: 0, state: "ready" },
			{ kind: "section", hits: [], total: 0, state: "ready" },
		]);
	});

	test("a source list cut at its cap is still searched and says how many files it holds, and acronyms reach the matcher", async () => {
		const files = new FileListCache(async () => ({
			paths: ["src/auth/UserController.ts", "src/auth/refresh.ts"],
			truncated: true,
		}));
		await files.load("/repos/one-auth", true);
		const service = createSearchService(
			readers({
				files,
				projects: () => [{ ...project, path: "/repos/one-auth" }],
				workspaces: () => [feature],
			}),
		);
		const capped = await service.query({
			query: "refresh",
			kinds: ["file"],
			context,
		});
		expect(capped.groups[0]).toMatchObject({ state: "ready", total: 1, cut: { fileList: 2 } });
		const acronym = await service.query({ query: "uc", kinds: ["file"], context });
		expect(acronym.groups[0]?.hits.map(pathOf)).toEqual(["src/auth/UserController.ts"]);
	});

	test("a provider that runs out of its budget answers what it has and says it was cut short", async () => {
		const many: FileList = {
			paths: Array.from({ length: 5_000 }, (_, index) => `src/refresh-${index}.ts`),
			truncated: false,
		};
		const files = new FileListCache(async () => many);
		await files.load("/repos/one-auth", true);
		let tick = 0;
		const service = createSearchService(
			readers({
				files,
				projects: () => [{ ...project, path: "/repos/one-auth" }],
				workspaces: () => [feature],
				now: () => {
					tick += 1;
					return tick <= 2 ? 0 : 10_000;
				},
			}),
		);
		const result = await service.query({
			query: "refresh",
			kinds: ["file"],
			context,
		});
		const file = result.groups[0];
		expect(file).toMatchObject({ state: "ready", cut: { time: true } });
		expect(file?.total).toBeGreaterThan(0);
		expect(file?.total).toBeLessThan(5_000);
	});

	test("limits clamp per group and the total survives, and a throwing provider reports failed", async () => {
		const many: FileList = {
			paths: Array.from({ length: 80 }, (_, index) => `src/refresh-${index}.ts`),
			truncated: false,
		};
		const files = new FileListCache(async () => many);
		await files.load("/repos/one-auth", true);
		const service = createSearchService(
			readers({
				files,
				projects: () => [project],
				workspaces: () => [feature],
				specs: () => {
					throw new Error("boom");
				},
				sections: () => {
					throw new Error("boom");
				},
			}),
		);
		const result = await service.query({ query: "refresh", limit: 500, context });
		const file = result.groups.find((group) => group.kind === "file");
		expect(file?.hits).toHaveLength(50);
		expect(file?.total).toBe(80);
		expect(result.groups.find((group) => group.kind === "spec")).toMatchObject({ state: "failed" });
		expect(result.groups.find((group) => group.kind === "section")).toMatchObject({
			state: "failed",
		});
	});

	test("sections take the query as typed, answer indexing until built, and stay out of a query that does not ask for them", async () => {
		const service = createSearchService(
			readers({
				sections: (root) => ({
					built: false,
					rebuilding: null,
					search: (query, limit) => {
						sectionQueries.push({ root, query, limit });
						return { hits: [], total: 0 };
					},
				}),
			}),
		);
		const asked = await service.query({
			query: '  "token refresh" Flow',
			kinds: ["section"],
			limit: 7,
			context,
		});
		expect(asked.groups).toEqual([{ kind: "section", hits: [], total: 0, state: "indexing" }]);
		expect(sectionQueries.at(-1)).toEqual({
			root: "/repos/one-auth",
			query: '  "token refresh" Flow',
			limit: 7,
		});
		const before = sectionQueries.length;
		await service.query({ query: "refresh", kinds: ["spec", "file"], context });
		expect(sectionQueries.length).toBe(before);
	});
});

describe("search.preview", () => {
	test("a chat preview is a bounded transcript window around the focused message", async () => {
		const service = createSearchService(readers());
		const preview = await service.preview({ kind: "chat", sessionId: "s1", messageIndex: 1 });
		expect(preview).toMatchObject({ kind: "transcript", title: "Fix auth token refresh" });
		if (preview.kind !== "transcript") throw new Error("expected a transcript");
		expect(preview.messages.map((message) => [message.messageIndex, message.focus])).toEqual([
			[0, false],
			[1, true],
		]);
		expect(await service.preview({ kind: "chat", sessionId: "s-cli" })).toEqual({
			kind: "unavailable",
		});
	});

	test("a preview whose message index drifted focuses the message its anchor starts, or none", async () => {
		const service = createSearchService(readers());
		const focused = async (messageIndex: number, anchorText: string) => {
			const preview = await service.preview({
				kind: "chat",
				sessionId: "s1",
				messageIndex,
				anchorText,
			});
			if (preview.kind !== "transcript") throw new Error("expected a transcript");
			return preview.messages
				.filter((message) => message.focus)
				.map((message) => message.messageIndex);
		};
		expect(await focused(1, "Done: the refresh")).toEqual([1]);
		expect(await focused(0, "Done: the refresh")).toEqual([1]);
		expect(await focused(5, "please refresh")).toEqual([0]);
		expect(await focused(1, "a message that is gone")).toEqual([]);
	});

	test("a preview of a chat the index is refreshing waits for the refreshed messages", async () => {
		let reads = 0;
		const stale: HistorySession = {
			...(sessions[0] as HistorySession),
			entries: [{ role: "user", text: "old text", timestamp: 1, messageIndex: 0, entryId: "o" }],
		};
		const service = createSearchService(
			readers({
				sessions: async () => {
					reads += 1;
					return reads === 1
						? { sessions: [stale], state: "refreshing" }
						: { sessions, state: "ready" };
				},
			}),
		);
		const preview = await service.preview({ kind: "chat", sessionId: "s1" });
		if (preview.kind !== "transcript") throw new Error("expected a transcript");
		expect(preview.messages.map((message) => message.text)).toContain(
			"please refresh the token flow",
		);
		expect(reads).toBe(2);
	});

	test("a preview waits for the history index to reach a chat it has not indexed yet", async () => {
		let reads = 0;
		const service = createSearchService(
			readers({
				sessions: async () => {
					reads += 1;
					return reads < 3
						? { sessions: [], state: reads === 1 ? "cold" : "refreshing" }
						: { sessions, state: "ready" };
				},
			}),
		);
		expect(await service.preview({ kind: "chat", sessionId: "s1" })).toMatchObject({
			kind: "transcript",
		});
		expect(reads).toBe(3);
	});

	test("a chat whose folder is no open project's workspace has no preview", async () => {
		const service = createSearchService(readers({ workspaces: () => [defaultOne] }));
		expect(await service.preview({ kind: "chat", sessionId: "s1" })).toEqual({
			kind: "unavailable",
		});
	});
});

describe("chats without a project", () => {
	const chatsProject: Project = {
		id: "c",
		name: "Chats",
		path: "/data/chats",
		slug: "chats",
		lastOpened: 3,
		kind: "chats",
	};
	const chatRecord: Workspace = {
		id: "w-chat",
		projectId: "c",
		kind: "chat",
		name: "Chat",
		branch: "",
		worktreePath: "/data/chats/2026-10-26-ab12cd",
		baseBranch: "",
	};
	const chatSession: HistorySession = {
		sessionId: "s-chat",
		cwd: chatRecord.worktreePath,
		title: "Refresh the garden",
		entries: [
			{
				role: "user",
				text: "refresh the garden beds",
				timestamp: 40,
				messageIndex: 0,
				entryId: "g0",
			},
		],
	};
	const chatPlan: StoredPlanFile = {
		sessionId: "s-chat",
		path: `${chatRecord.worktreePath}/.thinkrail/context/todos/s-chat.json`,
		read: () => ({
			todos: [
				{
					id: "tg",
					title: "Refresh the soil",
					status: "pending",
					origin: "agent",
					createdAt: "",
					updatedAt: "",
				},
			],
			groups: [],
		}),
	};
	const withChats = () =>
		createSearchService(
			readers({
				projects: () => [project, other, chatsProject],
				workspaces: () => [defaultOne, feature, chatRecord],
				sessions: async () => ({ sessions: [...sessions, chatSession], state: "ready" }),
				plans: (root) => (root === chatRecord.worktreePath ? [chatPlan] : (plans[root] ?? [])),
				files: new FileListCache(async () => ({ paths: ["garden-refresh.md"], truncated: false })),
			}),
		);
	const chatContext = { projectId: "c", workspaceId: "w-chat" };
	const aboutTheChat = (hit: { workspaceId?: string; sessionId?: string; projectId?: string }) =>
		hit.workspaceId === "w-chat" || hit.sessionId === "s-chat" || hit.projectId === "c";

	test("a client older than them learns nothing of the container, its chats or their sessions, before ranking", async () => {
		const service = withChats();
		const older = await service.query({ query: "refresh", context: chatContext }, { chats: false });
		const byKind = Object.fromEntries(older.groups.map((group) => [group.kind, group]));
		expect(older.groups.flatMap((group) => group.hits).filter(aboutTheChat)).toEqual([]);
		expect(byKind.file).toMatchObject({ state: "ready", hits: [], total: 0 });
		expect(byKind.transcript?.total).toBe(
			byKind.transcript?.hits.filter((hit) => !aboutTheChat(hit)).length,
		);
		expect(await service.preview({ kind: "chat", sessionId: "s-chat" }, { chats: false })).toEqual({
			kind: "unavailable",
		});

		const current = await service.query(
			{ query: "refresh", context: chatContext },
			{ chats: true },
		);
		const ids = current.groups.flatMap((group) => group.hits.map((hit) => hit.id));
		expect(ids).toContain("transcript:s-chat:g0");
		expect(ids).toContain("plan:w-chat:s-chat:tg");
		expect(ids).toContain("file:w-chat:garden-refresh.md");
		expect(
			await service.preview({ kind: "chat", sessionId: "s-chat" }, { chats: true }),
		).toMatchObject({ kind: "transcript", title: "Refresh the garden" });
	});

	test("a chat whose deletion did not finish is in no corpus for any audience and has no preview", async () => {
		const service = createSearchService(
			readers({
				projects: () => [project, other, chatsProject],
				workspaces: () => [defaultOne, feature, { ...chatRecord, deletionPending: true }],
				sessions: async () => ({ sessions: [...sessions, chatSession], state: "ready" }),
				plans: (root) => (root === chatRecord.worktreePath ? [chatPlan] : (plans[root] ?? [])),
				files: new FileListCache(async () => ({ paths: ["refresh.md"], truncated: false })),
			}),
		);
		const result = await service.query({ query: "refresh", context: chatContext }, { chats: true });
		expect(result.groups.flatMap((group) => group.hits).filter(aboutTheChat)).toEqual([]);
		expect(result.groups.find((group) => group.kind === "file")).toMatchObject({
			hits: [],
			total: 0,
		});
		expect(await service.preview({ kind: "chat", sessionId: "s-chat" }, { chats: true })).toEqual({
			kind: "unavailable",
		});
	});

	test("the Chats container is never provisioned as a root: a query in its context answers no files, not a failure", async () => {
		const provisioned: string[] = [];
		const service = createSearchService(
			readers({
				projects: () => [project, other, chatsProject],
				workspaces: () => [defaultOne, feature, chatRecord],
				ensureDefault: async (projectId) => {
					provisioned.push(projectId);
					throw new Error("not a repository");
				},
			}),
		);
		const result = await service.query({
			query: "notes",
			kinds: ["file", "spec"],
			context: { projectId: "c" },
		});
		const byKind = Object.fromEntries(result.groups.map((group) => [group.kind, group.state]));
		expect(byKind).toEqual({ file: "ready", spec: "ready" });
		expect(provisioned).toEqual([]);
	});

	test("a chat's root is walked for files and never indexed for specs", async () => {
		const walked: boolean[] = [];
		const files = new FileListCache(async (_root, git) => {
			walked.push(!git);
			return { paths: ["chat-notes.md"], truncated: false };
		});
		const specRoots: string[] = [];
		const service = createSearchService(
			readers({
				projects: () => [project, other, chatsProject],
				workspaces: () => [defaultOne, feature, chatRecord],
				specs: (root) => {
					specRoots.push(root);
					return {
						entries: [{ path: "SPEC.md", id: "chat", title: "Chat notes", type: "x", content: "" }],
						built: true,
						rebuilding: null,
					};
				},
				files,
			}),
		);
		const result = await service.query({
			query: "chat",
			kinds: ["file", "spec"],
			context: chatContext,
		});
		const byKind = Object.fromEntries(result.groups.map((group) => [group.kind, group]));
		expect(byKind.spec).toMatchObject({ state: "ready", hits: [], total: 0 });
		expect(byKind.file?.hits.map(pathOf)).toEqual(["chat-notes.md"]);
		expect(walked).toEqual([true]);
		expect(specRoots).toEqual([]);
	});
});
