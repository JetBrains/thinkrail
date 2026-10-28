import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Workspace } from "@thinkrail/contracts";
import { MATCH_TIER } from "@thinkrail/contracts";
import type { HistorySession } from "../history";
import type { SpecSnapshotEntry } from "../spec";
import type { StoredPlanFile } from "../todos";
import {
	type FileList,
	FileListCache,
	isTransientListFailure,
	listRootFiles,
	parseNulList,
	walkFileList,
} from "./files";
import { searchChatTitles, searchFiles, searchTranscripts } from "./providers";
import { createSearchService, resolveSearchRoot, type SearchReaders } from "./service";

const encoder = new TextEncoder();

function chunks(...parts: string[]): Uint8Array[] {
	return parts.map((part) => encoder.encode(part));
}

describe("parseNulList", () => {
	test("splits NUL-separated names across chunk boundaries and keeps a trailing unterminated name", async () => {
		const list = await parseNulList(chunks("a.ts\0src/b", ".ts\0", "odd name\0last"));
		expect(list).toEqual({ paths: ["a.ts", "src/b.ts", "odd name", "last"], truncated: false });
	});

	test("caps the number of entries and the bytes read", async () => {
		const capped = await parseNulList(chunks("a\0b\0c\0d\0"), { maxFiles: 2, maxBytes: 1_000 });
		expect(capped).toEqual({ paths: ["a", "b"], truncated: true });
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
		const list = await listRootFiles(dir);
		expect(list.truncated).toBe(false);
		expect([...list.paths].sort()).toEqual([
			".gitignore",
			"src/deep dir/spaced name.ts",
			"src/ünïcode.md",
			"tracked.txt",
		]);
	});

	test("a plain folder falls back to a bounded walk that skips node_modules", async () => {
		expect(await listRootFiles(plain)).toEqual({ paths: ["a.txt"], truncated: false });
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
			expect((await listRootFiles(repo)).paths).toEqual(["conflict.txt"]);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	test("a walk skips a folder it may not read but gives up on a failure that may pass", async () => {
		const dirent = (name: string, directory: boolean) =>
			({ name, isDirectory: () => directory, isFile: () => !directory }) as never;
		const failure = (code: string) => Object.assign(new Error(code), { code });
		const root = join(tmpdir(), "walk-root");
		const tree: Record<string, () => unknown[]> = {
			[join(root, "")]: () => [
				dirent("a.txt", false),
				dirent("locked", true),
				dirent("busy", true),
			],
			[join(root, "locked")]: () => {
				throw failure("EACCES");
			},
			[join(root, "busy")]: () => [],
		};
		const read = async (path: string) => (tree[path]?.() ?? []) as never;
		expect(await walkFileList(root, read)).toEqual({ paths: ["a.txt"], truncated: false });
		tree[join(root, "busy")] = () => {
			throw failure("EMFILE");
		};
		await expect(walkFileList(root, read)).rejects.toThrow("EMFILE");
		expect(await walkFileList("/gone", async () => Promise.reject(failure("ENOENT")))).toEqual({
			paths: [],
			truncated: false,
		});
	});

	test("only a failure that may pass counts as transient", () => {
		expect(isTransientListFailure({ timedOut: true })).toBe(true);
		expect(isTransientListFailure({ code: "EMFILE" })).toBe(true);
		expect(isTransientListFailure({ message: "fatal: Too many open files" })).toBe(true);
		expect(isTransientListFailure({ message: "fatal: not a git repository" })).toBe(false);
		expect(isTransientListFailure({ code: "EACCES" })).toBe(false);
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
		})),
	});
	const input = (query: string, checks: number) => ({
		terms: [{ text: query, literal: false }],
		limit: 20,
		deadline: budget(checks),
	});
	const old = session("old", "Token refresh, the long one", 1_000, Array(500).fill("refresh"));
	const recent = session("recent", "Quantum banana", 9_000, ["refresh the cache"]);

	test("a budget that runs out leaves older messages unsearched, never the newest chat's", () => {
		const group = searchTranscripts([old, recent], false, label, input("refresh", 3));
		expect(group.state).toBe("truncated");
		expect(group.hits.map((hit) => hit.id)).toEqual([
			"transcript:recent:0",
			"transcript:old:499",
			"transcript:old:498",
		]);
	});

	test("titles are matched over every chat, apart from the transcript budget", () => {
		const group = searchChatTitles([old, recent], false, label, input("banana", 0));
		expect(group.state).toBe("ready");
		expect(group.hits.map((hit) => hit.id)).toEqual(["chat:recent"]);
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
		const cold = files.load("/r");
		deferred.finish(["a.ts"]);
		await cold;
		files.invalidate("/r");
		expect(files.peek("/r")?.paths).toEqual(["a.ts"]);
		expect(files.reloading("/r")).toBe(true);
		files.invalidate("/r");
		deferred.finish(["a.ts", "b.ts"]);
		await Bun.sleep(0);
		expect(files.peek("/r")?.paths).toEqual(["a.ts", "b.ts"]);
		expect(files.reloading("/r")).toBe(true);
		deferred.finish(["a.ts", "b.ts", "c.ts"]);
		await Bun.sleep(0);
		expect(files.peek("/r")?.paths).toEqual(["a.ts", "b.ts", "c.ts"]);
		expect(files.reloading("/r")).toBe(false);
		expect(deferred.loads()).toBe(3);
	});

	test("a change during the first load leaves it stale too", async () => {
		const deferred = deferredLoader();
		const files = new FileListCache(deferred.loader);
		const cold = files.load("/r");
		files.invalidate("/r");
		deferred.finish(["a.ts"]);
		await cold;
		expect(files.peek("/r")?.paths).toEqual(["a.ts"]);
		expect(files.reloading("/r")).toBe(true);
	});

	test("a file hit carries its size on disk so the client can decline to preview a large one", async () => {
		const dir = mkdtempSync(join(tmpdir(), "thinkrail-search-size-"));
		try {
			writeFileSync(join(dir, "big.log"), "x".repeat(4096));
			const files = new FileListCache(async () => ({
				paths: ["big.log", "gone.log"],
				truncated: false,
			}));
			await files.load(dir);
			const group = searchFiles({ root: dir, projectId: "p1", workspaceId: "w1" }, files, {
				terms: [{ text: "log", literal: false }],
				limit: 20,
				deadline: { expired: () => false },
			});
			expect(Object.fromEntries(group.hits.map((hit) => [hit.path, hit.size]))).toEqual({
				"big.log": 4096,
				"gone.log": undefined,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a first load that fails answers failed and is tried again on the next ask", async () => {
		let fail = true;
		const files = new FileListCache(async () => {
			if (fail) throw new Error("EMFILE");
			return { paths: ["src/refresh.ts"], truncated: false };
		});
		const root = { root: "/r", projectId: "p1", workspaceId: "w1" };
		const input = (query: string) => ({
			terms: [{ text: query, literal: false }],
			limit: 20,
			deadline: { expired: () => false },
		});
		await files.load("/r");
		fail = false;
		expect(searchFiles(root, files, input("refresh"))).toMatchObject({ state: "failed", hits: [] });
		await Bun.sleep(0);
		expect(searchFiles(root, files, input("refresh")).hits.map((hit) => hit.path)).toEqual([
			"src/refresh.ts",
		]);
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
		).toEqual({ root: "/repos/one-auth", projectId: "p1", workspaceId: "w-feature" });
		expect(resolveSearchRoot([other, project], [defaultOne], { projectId: "p1" })).toEqual({
			root: "/repos/one",
			projectId: "p1",
			workspaceId: "w-default",
		});
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
			{ role: "user", text: "please refresh the token flow", timestamp: 10, messageIndex: 0 },
			{
				role: "assistant",
				text: "Done: the refresh now retries once.",
				timestamp: 11,
				messageIndex: 1,
			},
		],
	},
	{
		sessionId: "s2",
		cwd: "/repos/one",
		title: "Billing redesign",
		entries: [{ role: "user", text: "billing page", timestamp: 20, messageIndex: 0 }],
	},
	{
		sessionId: "s-cli",
		cwd: "/somewhere/else",
		title: "Refresh notes",
		entries: [{ role: "user", text: "refresh", timestamp: 30, messageIndex: 0 }],
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
		sessions: async () => ({ sessions, indexing: false }),
		specs: (root) => ({ entries: specs[root] ?? [], rebuilding: false }),
		plans: (root) => plans[root] ?? [],
		invalidateSpecs: () => {},
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
	test("answers every kind for a typed query: files and specs from the one root, chats from the open projects", async () => {
		const files = new FileListCache(async (root) => lists[root] ?? { paths: [], truncated: false });
		await Promise.all(Object.keys(lists).map((root) => files.load(root)));
		const service = createSearchService(readers({ files }));
		const result = await service.query("c1", { seq: 1, query: "refresh", context });
		expect(result.superseded).toBeUndefined();
		const byKind = Object.fromEntries(result.groups.map((group) => [group.kind, group]));

		expect(byKind.workspace?.hits.map((hit) => hit.id)).toEqual(["workspace:w-feature"]);
		expect(byKind.file?.hits.map((hit) => hit.id)).toEqual(["file:w-feature:src/auth/refresh.ts"]);
		expect(byKind.file?.hits[0]).toMatchObject({ projectId: "p1", workspaceId: "w-feature" });
		expect(byKind.spec?.hits).toEqual([
			expect.objectContaining({
				id: "spec:w-feature:SPEC.md",
				tier: MATCH_TIER.content,
				snippet: "The auth refresh lives in the token module.",
			}),
		]);
		expect(byKind.chat?.hits.map((hit) => hit.id)).toEqual(["chat:s1"]);
		expect(byKind.chat?.hits[0]).toMatchObject({ workspaceId: "w-feature", projectId: "p1" });
		expect(byKind.transcript?.hits.map((hit) => hit.id)).toEqual([
			"transcript:s1:1",
			"transcript:s1:0",
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
		await files.load("/repos/one-auth");
		const service = createSearchService(readers({ files }));
		const paths = async (seq: number, query: string) =>
			(await service.query("c1", { seq, query, kinds: ["file"], context })).groups[0]?.hits
				.map((hit) => hit.path)
				.sort();
		expect(await paths(1, "cafe")).toEqual(["docs/Café.md", "src/cafe/menu.ts"]);
		expect(await paths(2, "CAFÉ")).toEqual(["docs/Café.md", "src/cafe/menu.ts"]);
		expect(await paths(3, "fb")).toEqual(["src/FooBar.ts"]);
		expect(await paths(4, '"fb"')).toEqual([]);
	});

	test("a quoted phrase is one term for transcripts and spec bodies", async () => {
		const service = createSearchService(
			readers({ files: new FileListCache(async () => ({ paths: [], truncated: false })) }),
		);
		const ids = async (seq: number, query: string) =>
			(
				await service.query("c1", { seq, query, kinds: ["transcript", "spec"], context })
			).groups.flatMap((group) => group.hits.map((hit) => hit.id));
		expect(await ids(1, "flow token")).toContain("transcript:s1:0");
		expect(await ids(2, '"token flow"')).toContain("transcript:s1:0");
		expect(await ids(3, '"flow token"')).toEqual([]);
		expect(await ids(4, '"the token module"')).toEqual(["spec:w-feature:SPEC.md"]);
		expect(await ids(5, '"module token"')).toEqual([]);
	});

	test("a plan whose session the history has not reached yet answers indexing, so it is asked again", async () => {
		const building = createSearchService(
			readers({
				files: new FileListCache(async () => ({ paths: [], truncated: false })),
				sessions: async () => ({ sessions: [], indexing: true }),
			}),
		);
		const cold = await building.query("c1", { seq: 1, query: "refresh", kinds: ["plan"], context });
		expect(cold.groups[0]).toMatchObject({ kind: "plan", state: "indexing", hits: [] });
		const built = createSearchService(
			readers({ files: new FileListCache(async () => ({ paths: [], truncated: false })) }),
		);
		const warm = await built.query("c1", { seq: 1, query: "refresh", kinds: ["plan"], context });
		expect(warm.groups[0]?.state).toBe("ready");
		expect(warm.groups[0]?.hits.map((hit) => hit.id)).toContain("plan:w-feature:s1:t1");
	});

	test("an empty query answers empty groups and `kinds` narrows the providers", async () => {
		const service = createSearchService(
			readers({ files: new FileListCache(async () => lists["/repos/one"] as FileList) }),
		);
		const empty = await service.query("c1", { seq: 1, query: "   ", context });
		expect(empty.groups.every((group) => group.hits.length === 0)).toBe(true);
		const narrowed = await service.query("c1", {
			seq: 2,
			query: "refresh",
			kinds: ["chat"],
			context,
		});
		expect(narrowed.groups.map((group) => group.kind)).toEqual(["chat"]);
	});

	test("a cold file list reports indexing, loads once, and answers on the next query", async () => {
		let loads = 0;
		const files = new FileListCache(async (root) => {
			loads += 1;
			return lists[root] ?? { paths: [], truncated: false };
		});
		const service = createSearchService(readers({ files }));
		const cold = await service.query("c1", { seq: 1, query: "refresh", kinds: ["file"], context });
		expect(cold.groups[0]).toMatchObject({ kind: "file", state: "indexing", hits: [] });
		await Bun.sleep(0);
		const warm = await service.query("c1", { seq: 2, query: "refresh", kinds: ["file"], context });
		expect(warm.groups[0]?.state).toBe("ready");
		expect(warm.groups[0]?.hits).toHaveLength(1);
		expect(loads).toBe(1);
	});

	test("a root invalidated after a change keeps answering while it reloads, and the other roots stay cold", async () => {
		let loads = 0;
		const files = new FileListCache(async (root) => {
			loads += 1;
			return lists[root] ?? { paths: [], truncated: false };
		});
		await files.load("/repos/one-auth");
		const service = createSearchService(readers({ files }));
		const warm = await service.query("c1", { seq: 1, query: "refresh", kinds: ["file"], context });
		expect(warm.groups[0]).toMatchObject({ kind: "file", state: "ready" });
		expect(warm.groups[0]?.hits.map((hit) => hit.id)).toEqual([
			"file:w-feature:src/auth/refresh.ts",
		]);
		expect(loads).toBe(1);

		service.invalidateRoot("/repos/one-auth");
		const stale = await service.query("c1", { seq: 2, query: "refresh", kinds: ["file"], context });
		expect(stale.groups[0]?.state).toBe("indexing");
		expect(stale.groups[0]?.hits).toHaveLength(1);
		await Bun.sleep(0);
		expect(loads).toBe(2);
		const fresh = await service.query("c1", { seq: 3, query: "refresh", kinds: ["file"], context });
		expect(fresh.groups[0]?.state).toBe("ready");
		expect(files.peek("/repos/one")).toBeNull();
	});

	test("a failed reload keeps the stale list answering, and a spec snapshot being rebuilt reports indexing", async () => {
		let fail = false;
		const files = new FileListCache(async (root) => {
			if (fail) throw new Error("EMFILE");
			return lists[root] ?? { paths: [], truncated: false };
		});
		await files.load("/repos/one-auth");
		fail = true;
		files.invalidate("/repos/one-auth");
		expect(files.peek("/repos/one-auth")?.paths).toHaveLength(3);
		await Bun.sleep(0);
		expect(files.peek("/repos/one-auth")?.paths).toHaveLength(3);
		expect(files.reloading("/repos/one-auth")).toBe(true);

		const service = createSearchService(
			readers({
				files,
				specs: (root) => ({ entries: specs[root] ?? [], rebuilding: true }),
			}),
		);
		const result = await service.query("c1", {
			seq: 1,
			query: "refresh",
			kinds: ["spec"],
			context,
		});
		expect(result.groups[0]).toMatchObject({ kind: "spec", state: "indexing" });
		expect(result.groups[0]?.hits).toHaveLength(1);
	});

	test("the file-list cache keeps a bounded number of roots, and no root answers empty file and spec groups", async () => {
		const files = new FileListCache(async () => ({ paths: ["a.ts"], truncated: false }));
		for (let index = 0; index < 10; index += 1) await files.load(`/root-${index}`);
		expect(files.peek("/root-0")).toBeNull();
		expect(files.peek("/root-9")).not.toBeNull();

		const service = createSearchService(readers({ files }));
		const homeless = await service.query("c1", {
			seq: 1,
			query: "refresh",
			kinds: ["file", "spec"],
			context: {},
		});
		expect(homeless.groups).toEqual([
			{ kind: "file", hits: [], total: 0, state: "ready" },
			{ kind: "spec", hits: [], total: 0, state: "ready" },
		]);
	});

	test("a source list cut at its cap is still searched and reported truncated, and acronyms reach the matcher", async () => {
		const files = new FileListCache(async () => ({
			paths: ["src/auth/UserController.ts", "src/auth/refresh.ts"],
			truncated: true,
		}));
		await files.load("/repos/one-auth");
		const service = createSearchService(
			readers({
				files,
				projects: () => [{ ...project, path: "/repos/one-auth" }],
				workspaces: () => [feature],
			}),
		);
		const capped = await service.query("c1", {
			seq: 1,
			query: "refresh",
			kinds: ["file"],
			context,
		});
		expect(capped.groups[0]).toMatchObject({ state: "truncated", total: 1 });
		const acronym = await service.query("c1", { seq: 2, query: "uc", kinds: ["file"], context });
		expect(acronym.groups[0]?.hits.map((hit) => hit.path)).toEqual(["src/auth/UserController.ts"]);
	});

	test("a provider that runs out of its budget answers what it has as truncated", async () => {
		const many: FileList = {
			paths: Array.from({ length: 5_000 }, (_, index) => `src/refresh-${index}.ts`),
			truncated: false,
		};
		const files = new FileListCache(async () => many);
		await files.load("/repos/one-auth");
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
		const result = await service.query("c1", {
			seq: 1,
			query: "refresh",
			kinds: ["file"],
			context,
		});
		const file = result.groups[0];
		expect(file?.state).toBe("truncated");
		expect(file?.total).toBeGreaterThan(0);
		expect(file?.total).toBeLessThan(5_000);
	});

	test("an older seq from the same client is superseded, also when a newer one arrived mid-flight", async () => {
		const gate = Promise.withResolvers<void>();
		const service = createSearchService(
			readers({
				sessions: async () => {
					await gate.promise;
					return { sessions, indexing: false };
				},
			}),
		);
		const first = service.query("c1", { seq: 1, query: "refresh", kinds: ["chat"], context });
		const second = service.query("c1", { seq: 2, query: "refresh", kinds: ["chat"], context });
		const stale = await service.query("c1", { seq: 1, query: "refresh", kinds: ["chat"], context });
		expect(stale).toEqual({ seq: 1, groups: [], superseded: true });
		gate.resolve();
		expect(await first).toEqual({ seq: 1, groups: [], superseded: true });
		const latest = await second;
		expect(latest.superseded).toBeUndefined();
		expect(latest.groups[0]?.hits).toHaveLength(1);
		const otherClient = await service.query("c2", {
			seq: 0,
			query: "refresh",
			kinds: ["chat"],
			context,
		});
		expect(otherClient.superseded).toBeUndefined();
	});

	test("limits clamp per group and the total survives, and a throwing provider reports failed", async () => {
		const many: FileList = {
			paths: Array.from({ length: 80 }, (_, index) => `src/refresh-${index}.ts`),
			truncated: false,
		};
		const files = new FileListCache(async () => many);
		await files.load("/repos/one-auth");
		const service = createSearchService(
			readers({
				files,
				projects: () => [project],
				workspaces: () => [feature],
				specs: () => {
					throw new Error("boom");
				},
			}),
		);
		const result = await service.query("c1", { seq: 1, query: "refresh", limit: 500, context });
		const file = result.groups.find((group) => group.kind === "file");
		expect(file?.hits).toHaveLength(50);
		expect(file?.total).toBe(80);
		expect(result.groups.find((group) => group.kind === "spec")).toMatchObject({ state: "failed" });
	});
});

describe("search.preview", () => {
	test("a chat preview is a bounded transcript window around the focused message", async () => {
		const service = createSearchService(readers());
		const preview = await service.preview({ kind: "chat", sessionId: "s1", messageIndex: 1 });
		expect(preview).toMatchObject({
			kind: "transcript",
			title: "Fix auth token refresh",
			truncated: false,
		});
		if (preview.kind !== "transcript") throw new Error("expected a transcript");
		expect(preview.messages.map((message) => [message.messageIndex, message.focus])).toEqual([
			[0, false],
			[1, true],
		]);
		expect(await service.preview({ kind: "chat", sessionId: "s-cli" })).toEqual({
			kind: "unavailable",
			reason: "missing",
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

	test("a chat whose folder is no open project's workspace has no preview", async () => {
		const service = createSearchService(readers({ workspaces: () => [defaultOne] }));
		expect(await service.preview({ kind: "chat", sessionId: "s1" })).toEqual({
			kind: "unavailable",
			reason: "missing",
		});
	});
});
