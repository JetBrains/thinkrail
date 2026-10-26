import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Workspace } from "@thinkrail/contracts";
import { MATCH_TIER } from "@thinkrail/contracts";
import type { HistorySession } from "../history";
import type { SpecSnapshotEntry } from "../spec";
import type { StoredPlanFile } from "../todos";
import { type FileList, FileListCache, listRootFiles, parseNulList } from "./files";
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
		specs: (root) => specs[root] ?? [],
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
			"transcript:s1:0",
			"transcript:s1:1",
		]);
		expect(byKind.transcript?.hits[0]).toMatchObject({
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
		expect(stale.groups[0]?.state).toBe("ready");
		expect(stale.groups[0]?.hits).toHaveLength(1);
		await Bun.sleep(0);
		expect(loads).toBe(2);
		expect(files.peek("/repos/one")).toBeNull();
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

	test("a chat whose folder is no open project's workspace has no preview", async () => {
		const service = createSearchService(readers({ workspaces: () => [defaultOne] }));
		expect(await service.preview({ kind: "chat", sessionId: "s1" })).toEqual({
			kind: "unavailable",
			reason: "missing",
		});
	});
});
