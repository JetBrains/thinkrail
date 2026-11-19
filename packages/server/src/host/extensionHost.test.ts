import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "@thinkrail/contracts";
import { configurePiRuntime } from "../agent";
import type { ExtensionSessionPlacement } from "../extensions";
import { resetChatsStoreForTests } from "../persistence";
import { resetConfigCache, updateConfig } from "../settings";
import { createChatRecord, markChatDeletionPending, resetChatIdCache } from "../workspaces";
import { extensionHostServices, messageAnchor, setExtensionEventPublisher } from "./extensionHost";

const saved = {
	data: process.env.THINKRAIL_DATA_DIR,
	agent: process.env.PI_CODING_AGENT_DIR,
};
const root = mkdtempSync(join(tmpdir(), "trpi-extension-host-"));
const dataDir = join(root, "data");
const repo = join(root, "repo");
const other = join(root, "other");
const managed = join(dataDir, "worktrees", "repo", "feature-a");
let chat: Workspace;
let pendingChat: Workspace;

beforeAll(() => {
	mkdirSync(dataDir, { recursive: true });
	process.env.THINKRAIL_DATA_DIR = dataDir;
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	resetChatsStoreForTests();
	resetChatIdCache();
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "p1", name: "Repo", path: repo, slug: "repo", lastOpened: 2 },
			{ id: "p2", name: "Other", path: other, slug: "other", lastOpened: 1 },
			{
				id: "p3",
				name: "Closed",
				path: join(root, "closed"),
				slug: "closed",
				lastOpened: 3,
				closed: true,
			},
		]),
	);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				kind: "default",
				name: "Default",
				branch: "main",
				worktreePath: repo,
				baseBranch: "main",
			},
			{
				id: "w2",
				projectId: "p1",
				name: "Feature A",
				branch: "feature-a",
				worktreePath: managed,
				baseBranch: "main",
				review: { kind: "pull-request", number: 7, state: "merged", url: "https://example.test/7" },
			},
			{
				id: "w3",
				projectId: "p2",
				kind: "default",
				name: "Default",
				branch: "trunk",
				worktreePath: other,
				baseBranch: "trunk",
			},
		]),
	);
	writeFileSync(
		join(dataDir, "session-lifecycle.json"),
		JSON.stringify({
			version: 1,
			completionBySession: {
				done: { runId: "run-1", completion: { completionId: "c-1", outcome: "succeeded" } },
			},
			cancelledRunBySession: {},
		}),
	);
	writeFileSync(
		join(dataDir, "session-receipts.json"),
		JSON.stringify({ version: 1, baselineComplete: true, handledCompletionBySession: {} }),
	);
	chat = createChatRecord(new Date(1_000));
	pendingChat = createChatRecord(new Date(2_000));
	markChatDeletionPending(pendingChat.id);
});

afterAll(() => {
	resetChatsStoreForTests();
	resetChatIdCache();
	rmSync(root, { recursive: true, force: true });
	if (saved.data === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = saved.data;
	if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved.agent;
});

const SIGNAL = new AbortController().signal;

describe("extensionHostServices", () => {
	test("hands the extension the signal its query table was built with", () => {
		const controller = new AbortController();
		expect(extensionHostServices("insights", controller.signal).signal).toBe(controller.signal);
	});

	test("gives each extension its own data folder and the live pi sessions root", () => {
		expect(extensionHostServices("insights", SIGNAL).dataDir).toBe(
			join(dataDir, "extensions", "insights"),
		);
		expect(extensionHostServices("other", SIGNAL).dataDir).toBe(
			join(dataDir, "extensions", "other"),
		);
		const host = extensionHostServices("insights", SIGNAL);
		expect(host.sessionsRoot()).toBe(join(root, "agent", "sessions"));
		process.env.PI_CODING_AGENT_DIR = join(root, "agent-2");
		expect(host.sessionsRoot()).toBe(join(root, "agent-2", "sessions"));
		process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	});

	test("lists the open projects and the Chats container with their workspaces, in host order", () => {
		const { projects } = extensionHostServices("insights", SIGNAL).sessionScope({ kind: "all" });
		expect(projects.map((project) => [project.id, project.kind])).toEqual([
			[chat.projectId, "chats"],
			["p1", "repository"],
			["p2", "repository"],
		]);
		expect(projects[1]?.workspaces).toEqual([
			{ id: "w1", name: "Default", kind: "default", branch: "main" },
			{ id: "w2", name: "Feature A", kind: "worktree", branch: "feature-a" },
		]);
		expect(projects[0]?.workspaces.map((workspace) => [workspace.id, workspace.kind])).toEqual([
			[chat.id, "chat"],
			[pendingChat.id, "chat"],
		]);
	});

	test("places a cwd in an open, removed or no workspace and hides a chat whose deletion is pending", () => {
		const { locate } = extensionHostServices("insights", SIGNAL).sessionScope({ kind: "all" });
		expect(locate(managed)).toEqual({
			projectId: "p1",
			workspaceId: "w2",
			workspaceName: "Feature A",
			workspace: "open",
		});
		expect(locate(chat.worktreePath)).toMatchObject({ workspaceId: chat.id, workspace: "open" });
		expect(locate(join(dataDir, "worktrees", "repo", "gone"))).toEqual({
			projectId: "p1",
			workspaceId: null,
			workspaceName: "gone",
			workspace: "removed",
		});
		expect(locate(join(dataDir, "worktrees", "repo", "feat", "nested"))).toMatchObject({
			workspaceName: "feat/nested",
			workspace: "removed",
		});
		const none: ExtensionSessionPlacement = {
			projectId: null,
			workspaceId: null,
			workspaceName: null,
			workspace: "none",
		};
		expect(locate(join(managed, "packages", "app"))).toEqual(none);
		expect(locate(join(dataDir, "worktrees", "closed", "old"))).toEqual(none);
		expect(locate(join(dataDir, "worktrees", "repo"))).toEqual(none);
		expect(locate(join(root, "elsewhere"))).toEqual(none);
		expect(locate(pendingChat.worktreePath)).toBeNull();
	});

	test("keeps a project scope to that project's open and removed workspaces", () => {
		const { locate, projects } = extensionHostServices("insights", SIGNAL).sessionScope({
			kind: "project",
			projectId: "p1",
		});
		expect(projects).toHaveLength(3);
		expect(locate(repo)).toMatchObject({ workspaceId: "w1", workspace: "open" });
		expect(locate(join(dataDir, "worktrees", "repo", "gone"))).toMatchObject({
			projectId: "p1",
			workspace: "removed",
		});
		expect(locate(other)).toBeNull();
		expect(locate(join(dataDir, "worktrees", "other", "gone"))).toBeNull();
		expect(locate(join(root, "elsewhere"))).toBeNull();
		expect(locate(chat.worktreePath)).toBeNull();
	});

	test("keeps a workspace scope to that workspace and places nothing for a chat scope", () => {
		const host = extensionHostServices("insights", SIGNAL);
		const workspace = host.sessionScope({ kind: "workspace", workspaceId: "w2" });
		expect(workspace.locate(managed)).toMatchObject({ workspaceId: "w2" });
		expect(workspace.locate(repo)).toBeNull();
		expect(workspace.locate(join(dataDir, "worktrees", "repo", "gone"))).toBeNull();
		const unknown = host.sessionScope({ kind: "project", projectId: "missing" });
		expect(unknown.locate(repo)).toBeNull();
		const single = host.sessionScope({ kind: "chat", sessionId: "s1" });
		expect(single.locate(repo)).toBeNull();
		expect(single.locate(join(root, "elsewhere"))).toBeNull();
	});

	test("finds a parent's delegation folders: the known workspace's, else a scan, existing ones only", async () => {
		const host = extensionHostServices("insights", SIGNAL);
		const delegation = join(dataDir, "delegation");
		mkdirSync(join(delegation, "w2", "parent-a"), { recursive: true });
		mkdirSync(join(delegation, "w1", "parent-a"), { recursive: true });
		mkdirSync(join(delegation, "gone-ws", "parent-b"), { recursive: true });
		mkdirSync(join(delegation, "older-ws", "parent-b"), { recursive: true });
		writeFileSync(join(delegation, "stray-file"), "");

		expect(await host.childTranscriptDirs("parent-a", managed)).toEqual([
			join(delegation, "w2", "parent-a"),
		]);
		expect(await host.childTranscriptDirs("parent-b", managed)).toEqual([]);
		expect(
			(
				await host.childTranscriptDirs("parent-b", join(dataDir, "worktrees", "repo", "gone"))
			).sort(),
		).toEqual([join(delegation, "gone-ws", "parent-b"), join(delegation, "older-ws", "parent-b")]);
		expect(await host.childTranscriptDirs("parent-c", join(root, "elsewhere"))).toEqual([]);
		expect(await host.childTranscriptDirs("../w2", join(root, "elsewhere"))).toEqual([]);
		rmSync(delegation, { recursive: true, force: true });
		expect(await host.childTranscriptDirs("parent-a", join(root, "elsewhere"))).toEqual([]);
	});

	test("anchors an entry of a session under the sessions root, never a file elsewhere", async () => {
		const sessions = join(root, "agent", "sessions", "--repo--");
		mkdirSync(sessions, { recursive: true });
		const file = join(sessions, "s.jsonl");
		writeFileSync(
			file,
			[
				JSON.stringify({
					type: "session",
					version: 3,
					id: "s",
					timestamp: "2026-01-01T00:00:00Z",
					cwd: repo,
				}),
				JSON.stringify({
					type: "message",
					id: "u1",
					parentId: null,
					message: { role: "user", content: "hello", timestamp: 1 },
				}),
				JSON.stringify({
					type: "message",
					id: "a1",
					parentId: "u1",
					message: {
						role: "assistant",
						content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }],
						timestamp: 2,
					},
				}),
				JSON.stringify({
					type: "message",
					id: "r1",
					parentId: "a1",
					message: { role: "toolResult", toolCallId: "t1", content: [], timestamp: 3 },
				}),
			].join("\n"),
		);
		const host = extensionHostServices("insights", SIGNAL);
		expect(await host.messageAnchor(file, "u1")).toEqual({
			messageIndex: 0,
			anchorText: "hello",
			entryId: "u1",
			exact: true,
		});
		expect(await host.messageAnchor(file, "a1")).toEqual({
			messageIndex: 1,
			anchorText: "",
			entryId: "a1",
			exact: true,
			toolCallId: "t1",
		});
		expect(await host.messageAnchor(file, "r1")).toMatchObject({
			anchorText: "",
			toolCallId: "t1",
		});
		expect(await host.messageAnchor(join(sessions, "..", "..", "s.jsonl"), "u1")).toBeNull();
		expect(await messageAnchor(file, "u1", join(root, "elsewhere"))).toBeNull();
		expect(await host.messageAnchor(join(sessions, "missing.jsonl"), "u1")).toBeNull();
	});

	test("reports a session's liveness beside its last persisted outcome", () => {
		const host = extensionHostServices("insights", SIGNAL);
		expect(host.sessionStatus("done")).toEqual({
			live: false,
			completion: { completionId: "c-1", outcome: "succeeded" },
		});
		expect(host.sessionStatus("never-ran")).toEqual({ live: false, completion: null });
	});

	test("reads a model's context window from the host's model catalog, null when it has none", async () => {
		const runtime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			allowModelNetwork: false,
		});
		runtime.registerProvider("acme", {
			api: "anthropic-messages",
			apiKey: "fixture-only-key",
			baseUrl: "http://fixture.invalid",
			models: [
				{
					id: "big",
					name: "Big",
					api: "anthropic-messages",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 640_000,
					maxTokens: 32_000,
				},
			],
		});
		configurePiRuntime(runtime);
		try {
			const host = extensionHostServices("insights", SIGNAL);
			expect(await host.contextWindow("acme", "big")).toBe(640_000);
			expect(await host.contextWindow("acme", "missing")).toBeNull();
		} finally {
			configurePiRuntime(null);
		}
	});

	test("lists a session's turn receipts across workspaces, oldest first, paths as the host stored them", async () => {
		const turn = (id: string, workspaceId: string, sessionId: string, startedAt: number) => ({
			id,
			workspaceId,
			sessionId,
			startedAt,
			settledAt: startedAt + 1_000,
			baseTree: "a".repeat(40),
			headTree: "b".repeat(40),
			changes: [{ path: `src/${id}.ts`, status: "modified", added: 3, removed: 1 }],
		});
		writeFileSync(
			join(dataDir, "turns.json"),
			JSON.stringify({
				version: 1,
				byWorkspace: {
					w1: [turn("late", "w1", "s-receipts", 2_000), turn("other", "w1", "s-other", 1_500)],
					w2: [turn("early", "w2", "s-receipts", 1_000)],
				},
			}),
		);
		const host = extensionHostServices("insights", SIGNAL);
		expect(await host.turnReceipts("s-receipts")).toEqual([
			{
				startedAt: 1_000,
				settledAt: 2_000,
				changes: [{ path: "src/early.ts", status: "modified", added: 3, removed: 1 }],
			},
			{
				startedAt: 2_000,
				settledAt: 3_000,
				changes: [{ path: "src/late.ts", status: "modified", added: 3, removed: 1 }],
			},
		]);
		expect(await host.turnReceipts("s-none")).toEqual([]);
		rmSync(join(dataDir, "turns.json"), { force: true });
	});

	test("reads a receipt's recorded tree: regular files only, too large past the limits, null when gone", async () => {
		mkdirSync(join(other, "src"), { recursive: true });
		writeFileSync(join(other, "README.md"), "# Other\n");
		writeFileSync(join(other, "src", "a.ts"), "export const a = 1;\n");
		symlinkSync("README.md", join(other, "link.md"));
		const git = (...args: string[]) =>
			execFileSync("git", ["-C", other, ...args], { encoding: "utf8" }).trim();
		git("init", "-q");
		git("add", "-A");
		const headTree = git("write-tree");
		writeFileSync(
			join(dataDir, "turns.json"),
			JSON.stringify({
				version: 1,
				byWorkspace: {
					w3: [
						{
							id: "s-tree:5000",
							workspaceId: "w3",
							sessionId: "s-tree",
							startedAt: 5_000,
							settledAt: 6_000,
							baseTree: headTree,
							headTree,
							changes: [],
						},
					],
				},
			}),
		);
		const host = extensionHostServices("insights", SIGNAL);
		const tree = await host.turnTree("s-tree", 5_000, { files: 10, bytes: 1_000 });
		expect(tree?.kind).toBe("files");
		if (tree?.kind === "files")
			expect(tree.files.map((file) => [file.path, new TextDecoder().decode(file.bytes)])).toEqual([
				["README.md", "# Other\n"],
				["src/a.ts", "export const a = 1;\n"],
			]);
		expect(await host.turnTree("s-tree", 5_000, { files: 1, bytes: 1_000 })).toEqual({
			kind: "tooLarge",
			files: 2,
			bytes: 28,
		});
		expect(await host.turnTree("s-tree", 1, { files: 10, bytes: 1_000 })).toBeNull();
		rmSync(join(dataDir, "turns.json"), { force: true });
	});

	test("reports an open workspace's review, diff and chats as facts, null for one that is not open", async () => {
		const host = extensionHostServices("board", SIGNAL);
		expect(await host.workspaceFacts("w2")).toEqual({
			id: "w2",
			projectId: "p1",
			name: "Feature A",
			branch: "feature-a",
			baseBranch: "main",
			kind: "worktree",
			review: { kind: "pull-request", number: 7, state: "merged", url: "https://example.test/7" },
			diff: null,
			chats: [],
		});
		expect(await host.workspaceFacts(chat.id)).toMatchObject({
			kind: "chat",
			diff: null,
			review: null,
		});
		expect(await host.workspaceFacts("nope")).toBeNull();
	});

	test("publishes an extension's event in its own name, scoped, and drops it while the extension is off", () => {
		const pushes: unknown[] = [];
		setExtensionEventPublisher((push, scope) => pushes.push({ push, scope }));
		try {
			const host = extensionHostServices("board", SIGNAL);
			host.publish(
				"board.changed",
				{ projectId: "p1" },
				{
					projectId: "p1",
					workspaceId: 3 as unknown as string,
				},
			);
			expect(pushes).toEqual([
				{
					push: { extension: "board", type: "board.changed", payload: { projectId: "p1" } },
					scope: { projectId: "p1" },
				},
			]);
			expect(() => host.publish("", {})).toThrow();
			expect(() => host.publish("has space", {})).toThrow();
			updateConfig({ disabledExtensions: ["board"] });
			host.publish("board.changed", {});
			expect(pushes).toHaveLength(1);
		} finally {
			updateConfig({ disabledExtensions: [] });
			resetConfigCache();
			setExtensionEventPublisher(null);
		}
	});

	test("seeds an open workspace's artifacts folder and names it both ways", async () => {
		const host = extensionHostServices("insights", SIGNAL);
		mkdirSync(other, { recursive: true });
		const artifacts = await host.ensureArtifactsDir("w3");
		expect(artifacts).toEqual({
			dir: join(other, ".thinkrail", "context"),
			relative: ".thinkrail/context/",
		});
		expect(readFileSync(join(other, ".thinkrail", "context", ".gitignore"), "utf8")).toBe("*\n");
		expect(await host.ensureArtifactsDir("nope")).toBeNull();
		expect(existsSync(join(other, ".thinkrail", "context"))).toBe(true);
	});
});
