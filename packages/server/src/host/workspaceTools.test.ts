import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	Project,
	SessionState,
	SessionSummary,
	WireModel,
	Workspace,
	WorkspaceKickoff,
} from "@thinkrail/contracts";
import { WorkspaceCreationStopped } from "../workspaces";
import {
	type ChatReport,
	chatName,
	chatStateLabel,
	clampFinalMessage,
	composePrompt,
	matchWorkspaces,
	prepareAttachments,
	resolveModel,
	resolveProject,
	type StartWorkspaceDeps,
	startWorkspace,
	type WorkspaceStatusDeps,
	workspaceStatus,
} from "./workspaceTools";

let dir: string;

beforeEach(() => {
	dir = realpathSync(mkdtempSync(join(tmpdir(), "trpi-workspace-tools-")));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const project = (id: string, name: string, slug = name.toLowerCase()): Project => ({
	id,
	name,
	slug,
	path: `/repos/${slug}`,
	lastOpened: 1,
});

test("resolveProject defaults to the caller's project and matches open projects by id, slug, or name", () => {
	const open = [project("p1", "ThinkRail"), project("p2", "Backend", "backend-api")];
	expect(resolveProject(undefined, "p1", open).id).toBe("p1");
	expect(resolveProject("  ", "p1", open).id).toBe("p1");
	expect(resolveProject("p2", "p1", open).id).toBe("p2");
	expect(resolveProject("backend-api", "p1", open).id).toBe("p2");
	expect(resolveProject("thinkrail", "p2", open).id).toBe("p1");
	expect(() => resolveProject("frontend", "p1", open)).toThrow(
		'Unknown project "frontend". Open projects: ThinkRail (thinkrail), Backend (backend-api).',
	);
	expect(() => resolveProject(undefined, "closed", open)).toThrow("not open");
});

test("resolveProject never resolves or lists the Chats container, and a chat without a project must name one", () => {
	const chats: Project = { ...project("c1", "Chats"), kind: "chats" };
	const open = [chats, project("p1", "ThinkRail")];
	expect(resolveProject("thinkrail", undefined, open).id).toBe("p1");
	expect(() => resolveProject(undefined, undefined, open)).toThrow(
		"This chat has no project: pass `project`. Open projects: ThinkRail (thinkrail).",
	);
	expect(() => resolveProject("chats", "p1", open)).toThrow(
		'Unknown project "chats". Open projects: ThinkRail (thinkrail).',
	);
	expect(() => resolveProject(undefined, "c1", open)).toThrow("not open");
});

test("resolveModel accepts provider/id or a unique id and lists the available models otherwise", () => {
	const models = [
		{ provider: "anthropic", id: "claude" },
		{ provider: "openai", id: "gpt" },
		{ provider: "openrouter", id: "gpt" },
	] as WireModel[];
	expect(resolveModel("openai/gpt", models)).toBe(models[1] as WireModel);
	expect(resolveModel("claude", models)).toBe(models[0] as WireModel);
	expect(() => resolveModel("gpt", models)).toThrow('Ambiguous model "gpt"');
	expect(() => resolveModel("llama", models)).toThrow(
		"Available: anthropic/claude, openai/gpt, openrouter/gpt.",
	);
});

test("attachments: images become prompt images, other files absolute paths; missing files fail", () => {
	writeFileSync(join(dir, "shot.PNG"), Buffer.from([1, 2, 3]));
	writeFileSync(join(dir, "notes.md"), "# notes");
	const prepared = prepareAttachments(["shot.PNG", join(dir, "notes.md")], dir);
	expect(prepared.images).toEqual([
		{ type: "image", data: Buffer.from([1, 2, 3]).toString("base64"), mimeType: "image/png" },
	]);
	expect(prepared.files).toEqual([join(dir, "notes.md")]);
	expect(() => prepareAttachments(["missing.txt"], dir)).toThrow(
		`Attachment not found or not a file: ${join(dir, "missing.txt")}`,
	);
	expect(() => prepareAttachments([dir], dir)).toThrow("not a file");
});

test("composePrompt lists non-image attachments after the prompt", () => {
	expect(composePrompt("Do it", [])).toBe("Do it");
	expect(composePrompt("Do it", ["/a/b.md", "/c.txt"])).toBe(
		"Do it\n\nAttached files:\n- /a/b.md\n- /c.txt",
	);
});

const state = (patch: Partial<SessionState>): SessionState => ({
	execution: "idle",
	runId: null,
	needsInput: null,
	completion: null,
	completionUnread: false,
	queuedCount: 0,
	backgroundWork: false,
	...patch,
});

test("chatStateLabel maps session state to the agent-facing vocabulary", () => {
	expect(chatStateLabel(undefined)).toBe("idle");
	expect(chatStateLabel(state({}))).toBe("idle");
	expect(chatStateLabel(state({ execution: "running" }))).toBe("working");
	expect(chatStateLabel(state({ backgroundWork: true }))).toBe("working");
	expect(
		chatStateLabel(
			state({
				execution: "running",
				needsInput: { interactionId: "i1", kind: "tool-response", toolCallId: "t1" },
			}),
		),
	).toBe("needs_you");
	expect(chatStateLabel(state({ completion: { completionId: "c", outcome: "succeeded" } }))).toBe(
		"finished",
	);
	expect(
		chatStateLabel(
			state({ completion: { completionId: "c", outcome: "failed", failure: "error" } }),
		),
	).toBe("failed");
	expect(chatStateLabel(state({ completion: { completionId: "c", outcome: "cancelled" } }))).toBe(
		"interrupted",
	);
});

test("clampFinalMessage keeps the tail of a long final message", () => {
	expect(clampFinalMessage("short", 10)).toBe("short");
	expect(clampFinalMessage("0123456789abc", 4)).toBe("…9abc");
});

test("matchWorkspaces finds by id, branch, or name and reports misses", () => {
	const ws = (id: string, name: string, branch: string) =>
		({ id, name, branch, projectId: "p1" }) as Workspace;
	const all = [ws("w1", "Fix login", "fix-login"), ws("w2", "workspace-2", "workspace-2")];
	const { matched, missing } = matchWorkspaces(["w1", "FIX-LOGIN", "workspace-2", "nope"], all);
	expect(matched.map((w) => w.id)).toEqual(["w1", "w2"]);
	expect(missing).toEqual(["nope"]);
});

test("chatName prefers the chat's title, then its first prompt", () => {
	expect(chatName({ title: "Fix login" })).toBe('"Fix login"');
	expect(chatName({ title: " ", firstPrompt: "Add a test" })).toBe(
		'unnamed, first prompt "Add a test"',
	);
	expect(chatName({ title: "" })).toBe("unnamed");
});

function startDeps(overrides: Partial<StartWorkspaceDeps> = {}) {
	const calls: string[] = [];
	const kickoffs: WorkspaceKickoff[] = [];
	const caller = { id: "w1", projectId: "p1", worktreePath: dir } as Workspace;
	const child = {
		id: "w9",
		projectId: "p2",
		name: "workspace-9",
		branch: "workspace-9",
		baseBranch: "origin/main",
		worktreePath: "/wt/9",
	} as Workspace;
	const model = { provider: "anthropic", id: "claude" } as WireModel;
	const deps: StartWorkspaceDeps = {
		callerWorkspace: () => caller,
		openProjects: () => [project("p1", "ThinkRail"), project("p2", "Backend")],
		settledModels: async () => [model],
		defaultBaseBranch: async (projectId) => {
			calls.push(`defaultBase ${projectId}`);
			return "origin/main";
		},
		create: async (projectId, baseRef, kickoff, signal) => {
			calls.push(`create ${projectId} ${baseRef}${signal ? " signal" : ""}`);
			kickoffs.push(kickoff);
			return { workspace: child, sessionId: "s9", model, thinkingLevel: "high" };
		},
		...overrides,
	};
	return { deps, calls, kickoffs, child };
}

test("startWorkspace creates in the named project from its default base and hands the new chat its prompt", async () => {
	writeFileSync(join(dir, "spec.md"), "# spec");
	writeFileSync(join(dir, "shot.png"), "png");
	const { deps, calls, kickoffs } = startDeps();
	const started = await startWorkspace(
		"s1",
		{
			prompt: " Do X ",
			project: "backend",
			model: "claude",
			effort: "high",
			attachments: ["spec.md", "shot.png"],
		},
		deps,
		new AbortController().signal,
	);
	expect(calls).toEqual(["defaultBase p2", "create p2 origin/main signal"]);
	expect(kickoffs).toEqual([
		{
			text: `Do X\n\nAttached files:\n- ${join(dir, "spec.md")}`,
			images: [
				{ type: "image", data: Buffer.from("png").toString("base64"), mimeType: "image/png" },
			],
			model: { provider: "anthropic", id: "claude" } as WireModel,
			thinkingLevel: "high",
		},
	]);
	expect(started).toEqual({
		workspaceId: "w9",
		projectId: "p2",
		sessionId: "s9",
		name: "workspace-9",
		branch: "workspace-9",
		baseBranch: "origin/main",
		model: "anthropic/claude",
		effort: "high",
	});
});

test("startWorkspace validates project, model, and attachments before any worktree exists", async () => {
	for (const params of [
		{ prompt: "x", project: "nope" },
		{ prompt: "x", model: "llama" },
		{ prompt: "x", attachments: ["missing.png"] },
		{ prompt: "   " },
	]) {
		const { deps, calls } = startDeps();
		await expect(startWorkspace("s1", params, deps)).rejects.toThrow();
		expect(calls).toEqual([]);
	}
});

test("startWorkspace from a chat without a project needs a named repository and never cuts from Chats", async () => {
	const chats: Project = { ...project("c1", "Chats"), kind: "chats" };
	const caller = { id: "chat-1", projectId: "c1", kind: "chat", worktreePath: dir } as Workspace;
	const openProjects = () => [chats, project("p1", "ThinkRail"), project("p2", "Backend")];
	const refused = startDeps({ callerWorkspace: () => caller, openProjects });
	await expect(startWorkspace("s1", { prompt: "x" }, refused.deps)).rejects.toThrow(
		"This chat has no project: pass `project`. Open projects: ThinkRail (thinkrail), Backend (backend).",
	);
	expect(refused.calls).toEqual([]);
	const named = startDeps({ callerWorkspace: () => caller, openProjects });
	await startWorkspace("s1", { prompt: "x", project: "backend" }, named.deps);
	expect(named.calls).toEqual(["defaultBase p2", "create p2 origin/main"]);
	expect(named.kickoffs).toEqual([{ text: "x" }]);
});

test("startWorkspace names a created workspace, and its chat, when the chat fails", async () => {
	const unstarted = startDeps({
		create: async () => ({ workspace: unstarted.child, kickoffError: "no usable model" }),
	});
	await expect(
		startWorkspace("s1", { prompt: "x", base_branch: "dev" }, unstarted.deps),
	).rejects.toThrow(
		'Workspace "workspace-9" (id w9) was created, but its chat could not start: no usable model',
	);
	const refused = startDeps({
		create: async () => ({
			workspace: refused.child,
			sessionId: "s9",
			model: null,
			thinkingLevel: "medium",
			kickoffError: "provider refused",
		}),
	});
	await expect(
		startWorkspace("s1", { prompt: "x", base_branch: "dev" }, refused.deps),
	).rejects.toThrow(
		'Workspace "workspace-9" (id w9) and its chat s9 were created, but the chat did not take its prompt: provider refused',
	);
	expect(refused.calls).toEqual([]);
});

test("a Stop before or during the creation cuts no worktree and says so; a creation's own failure stays its own", async () => {
	const stop = new AbortController();
	const fetched = startDeps({
		defaultBaseBranch: async () => {
			stop.abort();
			return "origin/main";
		},
	});
	await expect(startWorkspace("s1", { prompt: "x" }, fetched.deps, stop.signal)).rejects.toThrow(
		"Stopped; no workspace was created.",
	);
	expect(fetched.calls).toEqual([]);

	const creating = startDeps({
		create: async () => {
			throw new WorkspaceCreationStopped("The workspace creation was stopped");
		},
	});
	await expect(
		startWorkspace("s1", { prompt: "x", base_branch: "dev" }, creating.deps),
	).rejects.toThrow("Stopped; no workspace was created.");

	const failing = startDeps({
		create: async () => {
			throw new Error("Could not fetch origin/dev: no such ref");
		},
	});
	await expect(
		startWorkspace("s1", { prompt: "x", base_branch: "origin/dev" }, failing.deps),
	).rejects.toThrow("Could not fetch origin/dev: no such ref");
});

const summary = (sessionId: string, title: string, patch: Partial<SessionState> = {}) =>
	({ sessionId, title, state: state(patch) }) as SessionSummary;

function statusDeps(overrides: Partial<WorkspaceStatusDeps> = {}) {
	const chats: Project = { ...project("c1", "Chats"), kind: "chats" };
	const repo = project("p1", "ThinkRail");
	const ws = (id: string, projectId: string, name: string, patch: Partial<Workspace> = {}) =>
		({ id, projectId, name, branch: name, baseBranch: "origin/main", ...patch }) as Workspace;
	const workspaces = [
		ws("w1", "p1", "main", { kind: "default", diffStats: { added: 1, removed: 2 } }),
		ws("w2", "p1", "fix-login", {
			review: { kind: "pull-request", number: 7, state: "open", url: "https://pr/7" },
		}),
		ws("chat-1", "c1", "main", { kind: "chat" }),
	];
	const reports: Record<string, ChatReport[] | Error> = {
		w1: [{ summary: summary("s1", "Plan") }],
		w2: [
			{ summary: summary("s2", "Fix it", { execution: "running" }), finalMessage: null },
			{
				summary: summary("s3", "", {
					completion: { completionId: "c", outcome: "succeeded" },
				}),
				finalMessage: "Done.\nOpened PR #7.",
			},
		],
		"chat-1": [{ summary: summary("s4", "Private chat"), finalMessage: "secret" }],
	};
	const deps: WorkspaceStatusDeps = {
		callerWorkspace: () => workspaces[0] as Workspace,
		openProjects: () => [chats, repo],
		allWorkspaces: () => workspaces,
		projectWorkspaces: async (projectId) => workspaces.filter((w) => w.projectId === projectId),
		withDiffStats: async (workspace) => workspace,
		chatReports: async (workspace, withFinal) => {
			const report = reports[workspace.id] ?? [];
			if (report instanceof Error) throw report;
			return withFinal ? report : report.map(({ summary }) => ({ summary }));
		},
		...overrides,
	};
	return { deps, reports };
}

test("workspace_status gives an overview of the caller's project without final messages", async () => {
	const { deps } = statusDeps();
	expect(await workspaceStatus("s1", {}, deps)).toBe(
		[
			"# ThinkRail: 2 workspace(s)",
			'## main — main (id w1, project ThinkRail, default)\nbase origin/main · no PR · diff +1 -2\n- chat "Plan" (s1, this chat): idle',
			'## fix-login — fix-login (id w2, project ThinkRail)\nbase origin/main · PR #7 open https://pr/7 · diff unknown\n- chat "Fix it" (s2): working\n- chat unnamed (s3): finished',
		].join("\n\n"),
	);
});

test("workspace_status by name reads final messages, never matches a chat without a project, and lists misses", async () => {
	const { deps, reports } = statusDeps();
	reports.w1 = new Error("transcripts unreadable");
	expect(await workspaceStatus("s1", { workspaces: ["MAIN", "fix-login", "nope"] }, deps)).toBe(
		[
			"No workspace matches: nope.",
			"## main — main (id w1, project ThinkRail, default)\nbase origin/main · no PR · diff +1 -2\nchats unreadable: transcripts unreadable",
			'## fix-login — fix-login (id w2, project ThinkRail)\nbase origin/main · PR #7 open https://pr/7 · diff unknown\n- chat "Fix it" (s2): working\n  final message: none yet\n- chat unnamed (s3): finished\n  final message:\n    Done.\n    Opened PR #7.',
		].join("\n\n"),
	);
});
