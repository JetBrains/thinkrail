import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ImageContent,
	Project,
	SessionState,
	WireModel,
	Workspace,
} from "@thinkrail/contracts";
import {
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
	const prompts: Array<{ sessionId: string; text: string; images?: ImageContent[] }> = [];
	const caller = { id: "w1", projectId: "p1", worktreePath: dir } as Workspace;
	const child = {
		id: "w9",
		projectId: "p2",
		name: "workspace-9",
		branch: "workspace-9",
		baseBranch: "origin/main",
		worktreePath: "/wt/9",
	} as Workspace;
	const deps: StartWorkspaceDeps = {
		callerWorkspace: () => caller,
		openProjects: () => [project("p1", "ThinkRail"), project("p2", "Backend")],
		settledModels: async () => [{ provider: "anthropic", id: "claude" } as WireModel],
		defaultBaseBranch: async () => {
			calls.push("defaultBase");
			return "origin/main";
		},
		createWorkspace: async (projectId, baseRef) => {
			calls.push(`create ${projectId} ${baseRef}`);
			return child;
		},
		startChat: async (_workspace, requested) => {
			calls.push(
				`chat ${requested.model?.id ?? "default"} ${requested.thinkingLevel ?? "default"}`,
			);
			return {
				sessionId: "s9",
				model: { provider: "anthropic", id: "claude" } as WireModel,
				thinkingLevel: "high",
			};
		},
		sendPrompt: async (sessionId, text, images) => {
			calls.push("prompt");
			prompts.push({ sessionId, text, ...(images ? { images } : {}) });
		},
		...overrides,
	};
	return { deps, calls, prompts };
}

test("startWorkspace creates in the named project from its default base and prompts the new chat", async () => {
	writeFileSync(join(dir, "spec.md"), "# spec");
	const { deps, calls, prompts } = startDeps();
	const started = await startWorkspace(
		"s1",
		{
			prompt: " Do X ",
			project: "backend",
			model: "claude",
			effort: "high",
			attachments: ["spec.md"],
		},
		deps,
	);
	expect(calls).toEqual(["defaultBase", "create p2 origin/main", "chat claude high", "prompt"]);
	expect(prompts).toEqual([
		{ sessionId: "s9", text: `Do X\n\nAttached files:\n- ${join(dir, "spec.md")}` },
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
		expect(calls.filter((call) => call.startsWith("create"))).toEqual([]);
	}
});

test("startWorkspace keeps a created workspace and names it when its chat cannot start", async () => {
	const { deps, calls } = startDeps({
		sendPrompt: async () => {
			throw new Error("provider refused");
		},
	});
	await expect(startWorkspace("s1", { prompt: "x", base_branch: "dev" }, deps)).rejects.toThrow(
		'Workspace "workspace-9" (id w9) was created, but its chat could not start: provider refused',
	);
	expect(calls).toEqual(["create p1 dev", "chat default default"]);
});
