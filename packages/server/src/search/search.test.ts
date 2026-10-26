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
import {
	createSearchService,
	resolveSearchRoots,
	type SearchReaders,
	trimIncompleteUtf8,
} from "./service";

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

describe("resolveSearchRoots", () => {
	test("the active worktree comes first, then every open project's folder with its Default record", () => {
		const roots = resolveSearchRoots([project, other], [defaultOne, feature], {
			projectId: "p1",
			workspaceId: "w-feature",
		});
		expect(roots).toEqual([
			{ root: "/repos/one-auth", projectId: "p1", workspaceId: "w-feature", current: true },
			{ root: "/repos/one", projectId: "p1", workspaceId: "w-default", current: false },
			{ root: "/repos/two", projectId: "p2", current: false },
		]);
	});

	test("working in the project folder lists it once, and Project Home makes the context project current", () => {
		expect(
			resolveSearchRoots([project], [defaultOne], { projectId: "p1", workspaceId: "w-default" }),
		).toEqual([{ root: "/repos/one", projectId: "p1", workspaceId: "w-default", current: true }]);
		expect(resolveSearchRoots([other, project], [defaultOne], { projectId: "p1" })).toEqual([
			{ root: "/repos/one", projectId: "p1", workspaceId: "w-default", current: true },
			{ root: "/repos/two", projectId: "p2", current: false },
		]);
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
	test("answers every kind for a typed query from the open projects only", async () => {
		const files = new FileListCache(async (root) => lists[root] ?? { paths: [], truncated: false });
		await Promise.all(Object.keys(lists).map((root) => files.load(root)));
		const service = createSearchService(readers({ files }));
		const result = await service.query("c1", { seq: 1, query: "refresh", context });
		expect(result.superseded).toBeUndefined();
		const byKind = Object.fromEntries(result.groups.map((group) => [group.kind, group]));

		expect(byKind.workspace?.hits.map((hit) => hit.id)).toEqual(["workspace:w-feature"]);
		expect(byKind.file?.hits.map((hit) => hit.id)).toEqual([
			"file:p1:w-feature:src/auth/refresh.ts",
			"file:p1:w-default:src/auth/refresh.ts",
			"file:p1:w-default:docs/refresh-notes.md",
		]);
		expect(byKind.spec?.hits).toEqual([
			expect.objectContaining({
				id: "spec:p1:w-feature:SPEC.md",
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
		expect(warm.groups[0]?.hits).toHaveLength(3);
		expect(loads).toBe(3);
	});

	test("a root invalidated after a change keeps answering while it reloads, and a cold root marks the group indexing even with hits", async () => {
		let loads = 0;
		const files = new FileListCache(async (root) => {
			loads += 1;
			return lists[root] ?? { paths: [], truncated: false };
		});
		await files.load("/repos/one-auth");
		const service = createSearchService(readers({ files }));
		const partial = await service.query("c1", {
			seq: 1,
			query: "refresh",
			kinds: ["file"],
			context,
		});
		expect(partial.groups[0]).toMatchObject({ kind: "file", state: "indexing" });
		expect(partial.groups[0]?.hits.map((hit) => hit.id)).toEqual([
			"file:p1:w-feature:src/auth/refresh.ts",
		]);
		await Bun.sleep(0);
		expect(loads).toBe(3);

		service.invalidateRoot("/repos/one-auth");
		const stale = await service.query("c1", { seq: 2, query: "refresh", kinds: ["file"], context });
		expect(stale.groups[0]?.state).toBe("ready");
		expect(stale.groups[0]?.hits).toHaveLength(3);
		await Bun.sleep(0);
		expect(loads).toBe(4);
	});

	test("the file-list cache keeps a bounded number of roots, never fewer than one query needs", async () => {
		const files = new FileListCache(async () => ({ paths: ["a.ts"], truncated: false }));
		for (let index = 0; index < 10; index += 1) await files.load(`/root-${index}`);
		expect(files.peek("/root-0")).toBeNull();
		expect(files.peek("/root-9")).not.toBeNull();

		const many = Array.from({ length: 9 }, (_, index) => ({
			...other,
			id: `p${index}`,
			path: `/many/${index}`,
		}));
		const wide = new FileListCache(async (root) => ({
			paths: [`${root.slice(1)}/refresh.ts`],
			truncated: false,
		}));
		const service = createSearchService(
			readers({ files: wide, projects: () => many, workspaces: () => [] }),
		);
		let result = await service.query("c1", {
			seq: 1,
			query: "refresh",
			kinds: ["file"],
			context: {},
		});
		for (let poll = 2; result.groups[0]?.state === "indexing" && poll < 6; poll += 1) {
			await Bun.sleep(0);
			result = await service.query("c1", {
				seq: poll,
				query: "refresh",
				kinds: ["file"],
				context: {},
			});
		}
		expect(result.groups[0]?.state).toBe("ready");
		expect(result.groups[0]?.total).toBe(9);
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

describe("trimIncompleteUtf8", () => {
	test("drops a multi-byte sequence cut by the byte limit and keeps complete text", () => {
		const whole = new TextEncoder().encode("abcé");
		expect(trimIncompleteUtf8(whole)).toEqual(whole);
		expect(new TextDecoder().decode(trimIncompleteUtf8(whole.subarray(0, 4)))).toBe("abc");
		const emoji = new TextEncoder().encode("a😀");
		expect(new TextDecoder().decode(trimIncompleteUtf8(emoji.subarray(0, 3)))).toBe("a");
		expect(trimIncompleteUtf8(new Uint8Array([0, 1, 2]))).toEqual(new Uint8Array([0, 1, 2]));
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

	test("a file preview reads a contained head only, and a spec preview comes from the snapshot", async () => {
		const dir = mkdtempSync(join(tmpdir(), "thinkrail-search-preview-"));
		try {
			mkdirSync(join(dir, "src"));
			writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
			writeFileSync(join(dir, "blob.bin"), new Uint8Array([0, 1, 2, 255, 0, 3]));
			const local: Project = { ...project, path: dir };
			const service = createSearchService(
				readers({ projects: () => [local], workspaces: () => [] }),
			);
			expect(await service.preview({ kind: "file", projectId: "p1", path: "src/a.ts" })).toEqual({
				kind: "text",
				title: "src/a.ts",
				body: "export const a = 1;\n",
				truncated: false,
			});
			expect(await service.preview({ kind: "file", projectId: "p1", path: "../escape" })).toEqual({
				kind: "unavailable",
				reason: "missing",
			});
			expect(await service.preview({ kind: "file", projectId: "p1", path: "blob.bin" })).toEqual({
				kind: "unavailable",
				reason: "binary",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
		const service = createSearchService(readers());
		expect(
			await service.preview({
				kind: "spec",
				projectId: "p1",
				workspaceId: "w-feature",
				path: "SPEC.md",
			}),
		).toMatchObject({ kind: "text", title: "Root", truncated: false });
		expect(
			await service.preview({ kind: "plan", workspaceId: "w-feature", sessionId: "s1" }),
		).toEqual({
			kind: "text",
			title: "",
			body: "## Auth refresh plan\n- [x] Refresh the token",
			truncated: false,
		});
	});
});
