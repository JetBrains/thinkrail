import { describe, expect, mock, test } from "bun:test";
import type { Project, WireModel, Workspace } from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import {
	type ExtensionActionDeps,
	extensionActions,
	extensionMessageContent,
	liveActionDeps,
	MAX_ASSIST_TOKENS,
	MAX_RUN_MS,
} from "./extensionActions";

const repo: Project = {
	id: "p1",
	name: "Repo",
	path: "/repo",
	slug: "repo",
	lastOpened: 1,
} as Project;
const chats: Project = {
	id: "chats",
	name: "Chats",
	path: "/chats",
	slug: "chats",
	kind: "chats",
	lastOpened: 0,
} as Project;
const feature: Workspace = {
	id: "w1",
	projectId: "p1",
	name: "Feature",
	branch: "feature",
	worktreePath: "/worktrees/feature",
	baseBranch: "main",
};
const chat: Workspace = {
	id: "chat-1",
	projectId: "chats",
	kind: "chat",
	name: "Chat",
	branch: "",
	worktreePath: "/chats/1",
	baseBranch: "",
};
const model = { provider: "acme", id: "big" } as WireModel;

function setup(
	overrides: Partial<ExtensionActionDeps> = {},
	signal = new AbortController().signal,
) {
	const disabled = new Set<string>();
	const create = mock<ExtensionActionDeps["create"]>(async () => ({
		workspace: { ...feature, id: "w-new", branch: "workspace-1" },
		sessionId: "s-new",
	}));
	const send = mock<ExtensionActionDeps["send"]>(async () => {});
	const abort = mock<ExtensionActionDeps["abort"]>(async () => {});
	const openPr = mock<ExtensionActionDeps["openPr"]>(async () => ({
		action: "created",
		dirtyFiles: 0,
		branch: "feature",
		url: "https://example.test/1",
	}));
	const run = mock<ExtensionActionDeps["run"]>(async () => ({
		ok: true,
		out: "listed",
		err: "",
		timedOut: false,
		launchFailed: false,
		waitedMs: 3,
	}));
	const assist = mock<ExtensionActionDeps["assist"]>(async () => "M");
	const startChat = mock<ExtensionActionDeps["startChat"]>(async () => ({ sessionId: "s-chat" }));
	const deps: ExtensionActionDeps = {
		isDisabled: (name) => disabled.has(name),
		title: () => "Board",
		projects: () => [repo, chats],
		containers: () => [{ id: "c1", name: "Docs", workspaceIds: [], createdAt: 0, updatedAt: 0 }],
		workspaces: () => [feature, chat],
		settledModels: async () => [model],
		defaultBaseBranch: async () => "main",
		create,
		startChat,
		chatWorkspace: async (sessionId) => (sessionId === "s1" ? feature : null),
		attach: async () => true,
		send,
		streaming: (sessionId) => sessionId === "running",
		abort,
		openPr,
		run,
		assist,
		...overrides,
	};
	return {
		actions: extensionActions("board", signal, deps),
		disabled,
		create,
		send,
		abort,
		openPr,
		run,
		assist,
		startChat,
	};
}

async function codeOf(answer: Promise<unknown>): Promise<string | undefined> {
	try {
		await answer;
	} catch (error) {
		return errorCodeOf(error) ?? "uncoded";
	}
	return undefined;
}

describe("extension host actions", () => {
	test("every action refuses while the extension is switched off, before any effect", async () => {
		const { actions, disabled, create, send, abort, openPr, run, assist, startChat } = setup();
		disabled.add("board");
		const refusals = await Promise.all([
			codeOf(actions.createWorkspace({ projectId: "p1", kickoff: { text: "go" } })),
			codeOf(actions.startChat({ workspaceId: "w1", kickoff: { text: "go" } })),
			codeOf(actions.sendToChat({ sessionId: "s1", text: "hi", mode: "follow_up" })),
			codeOf(actions.stopChat({ sessionId: "running" })),
			codeOf(actions.openPr({ workspaceId: "w1" })),
			codeOf(actions.runInWorkspace({ workspaceId: "w1", argv: ["gh"], timeoutMs: 1_000 })),
			codeOf(actions.assist({ prompt: "Size it" })),
		]);
		expect(refusals).toEqual([
			"EXTENSION_DISABLED",
			"EXTENSION_DISABLED",
			"EXTENSION_DISABLED",
			"EXTENSION_DISABLED",
			"EXTENSION_DISABLED",
			"EXTENSION_DISABLED",
			"EXTENSION_DISABLED",
		]);
		for (const effect of [create, startChat, send, abort, openPr, run, assist])
			expect(effect).not.toHaveBeenCalled();
	});

	test("createWorkspace starts a creation marked as the extension's, on the default base and a resolved model", async () => {
		const { actions, create } = setup();
		expect(
			await actions.createWorkspace({
				projectId: "p1",
				kickoff: { text: "  Card TR-1  ", model: "big", thinkingLevel: "high" },
				into: "c1",
			}),
		).toEqual({ workspaceId: "w-new", sessionId: "s-new", branch: "workspace-1" });
		expect(create.mock.calls).toEqual([
			[
				"p1",
				{
					baseRef: "main",
					kickoff: { text: "Card TR-1", model, thinkingLevel: "high" },
					origin: "extension",
					into: "c1",
				},
			],
		]);
		await actions.createWorkspace({
			projectId: "p1",
			baseRef: "release",
			name: "tr-1",
			kickoff: { text: "go" },
		});
		expect(create.mock.calls[1]?.[1]).toEqual({
			baseRef: "release",
			kickoff: { text: "go" },
			origin: "extension",
			name: "tr-1",
		});
	});

	test("createWorkspace validates before anything exists and names a workspace whose chat failed", async () => {
		const { actions, create } = setup();
		await expect(
			actions.createWorkspace({ projectId: "chats", kickoff: { text: "go" } }),
		).rejects.toThrow("No open repository project");
		await expect(
			actions.createWorkspace({ projectId: "p1", kickoff: { text: " " } }),
		).rejects.toThrow("kickoff text");
		expect(
			await codeOf(
				actions.createWorkspace({ projectId: "p1", into: "gone", kickoff: { text: "go" } }),
			),
		).toBe("CONTAINER_UNKNOWN");
		await expect(
			actions.createWorkspace({
				projectId: "p1",
				kickoff: { text: "go", thinkingLevel: "loud" as never },
			}),
		).rejects.toThrow("thinking level");
		await expect(
			actions.createWorkspace({ projectId: "p1", kickoff: { text: "go", model: "nope" } }),
		).rejects.toThrow('Unknown model "nope"');
		expect(create).not.toHaveBeenCalled();

		const failed = setup({
			create: async () => ({ workspace: feature, kickoffError: "no model" }),
		});
		await expect(
			failed.actions.createWorkspace({ projectId: "p1", kickoff: { text: "go" } }),
		).rejects.toThrow(
			'Workspace "Feature" (id w1) was created, but its chat could not start: no model',
		);
		const unsent = setup({
			create: async () => ({ workspace: feature, sessionId: "s2", kickoffError: "busy" }),
		});
		expect(
			await unsent.actions.createWorkspace({ projectId: "p1", kickoff: { text: "go" } }),
		).toEqual({ workspaceId: "w1", sessionId: "s2", branch: "feature", kickoffError: "busy" });
	});

	test("startChat opens a new chat in a repository workspace on a validated kickoff", async () => {
		const { actions, startChat } = setup();
		expect(
			await actions.startChat({
				workspaceId: "w1",
				kickoff: { text: "  /skill:roadmap-plan Plan I-1  ", model: "big", thinkingLevel: "low" },
			}),
		).toEqual({ workspaceId: "w1", sessionId: "s-chat" });
		expect(startChat.mock.calls).toEqual([
			[feature, { text: "/skill:roadmap-plan Plan I-1", model, thinkingLevel: "low" }],
		]);
		await expect(
			actions.startChat({ workspaceId: "gone", kickoff: { text: "go" } }),
		).rejects.toThrow("No open workspace gone");
		await expect(
			actions.startChat({ workspaceId: "chat-1", kickoff: { text: "go" } }),
		).rejects.toThrow("of a repository project");
		await expect(actions.startChat({ workspaceId: "w1", kickoff: { text: "" } })).rejects.toThrow(
			"kickoff text",
		);
		await expect(
			actions.startChat({ workspaceId: "w1", kickoff: { text: "go", model: "nope" } }),
		).rejects.toThrow('Unknown model "nope"');
		expect(startChat).toHaveBeenCalledTimes(1);

		const unsent = setup({
			startChat: async () => ({ sessionId: "s3", kickoffError: "No model selected" }),
		});
		expect(await unsent.actions.startChat({ workspaceId: "w1", kickoff: { text: "go" } })).toEqual({
			workspaceId: "w1",
			sessionId: "s3",
			kickoffError: "No model selected",
		});
	});

	test("sendToChat delivers the extension's words as its own card, as a follow-up or a steer", async () => {
		const { actions, send } = setup();
		await actions.sendToChat({ sessionId: "s1", text: " Rebase first ", mode: "follow_up" });
		await actions.sendToChat({ sessionId: "s1", text: "Stop", mode: "steer" });
		expect(send.mock.calls).toEqual([
			[
				"s1",
				extensionMessageContent("Board", "Rebase first"),
				{ extension: "board", extensionTitle: "Board", mode: "follow_up", text: "Rebase first" },
				"followUp",
			],
			[
				"s1",
				extensionMessageContent("Board", "Stop"),
				{ extension: "board", extensionTitle: "Board", mode: "steer", text: "Stop" },
				"steer",
			],
		]);
		expect(extensionMessageContent("Board", "x")).toContain("not the human");
		await expect(
			actions.sendToChat({ sessionId: "gone", text: "hi", mode: "steer" }),
		).rejects.toThrow("Unknown chat");
		await expect(
			actions.sendToChat({ sessionId: "s1", text: "hi", mode: "loud" as never }),
		).rejects.toThrow("Unknown mode");
		const detached = setup({ attach: async () => false });
		await expect(
			detached.actions.sendToChat({ sessionId: "s1", text: "hi", mode: "steer" }),
		).rejects.toThrow("could not be opened");
	});

	test("stopChat aborts a running chat only", async () => {
		const { actions, abort } = setup();
		expect(await actions.stopChat({ sessionId: "idle" })).toEqual({ stopped: false });
		expect(await actions.stopChat({ sessionId: "running" })).toEqual({ stopped: true });
		expect(abort.mock.calls).toEqual([["running"]]);
	});

	test("openPr opens a repository workspace's PR through the shared helper and refuses a chat", async () => {
		const { actions, openPr } = setup();
		expect(await actions.openPr({ workspaceId: "w1", title: "Card", draft: true })).toEqual({
			action: "created",
			dirtyFiles: 0,
			url: "https://example.test/1",
		});
		expect(openPr.mock.calls).toEqual([[feature, { title: "Card", draft: true }]]);
		await expect(actions.openPr({ workspaceId: "chat-1" })).rejects.toThrow("no worktree");
		await expect(actions.openPr({ workspaceId: "nope" })).rejects.toThrow("Unknown workspace");
	});

	test("runInWorkspace runs argv in the worktree, never a shell string or a chat folder, under a capped budget", async () => {
		const controller = new AbortController();
		const { actions, run } = setup({}, controller.signal);
		expect(
			await actions.runInWorkspace({
				workspaceId: "w1",
				argv: ["gh", "issue", "list", "--json", "number"],
				timeoutMs: 5_000,
			}),
		).toEqual({ ok: true, out: "listed", err: "", timedOut: false });
		await actions.runInWorkspace({
			workspaceId: "w1",
			argv: ["openspec"],
			timeoutMs: 10 * MAX_RUN_MS,
		});
		const { signal } = controller;
		expect(run.mock.calls).toEqual([
			[
				["gh", "issue", "list", "--json", "number"],
				{ timeoutMs: 5_000, cwd: "/worktrees/feature", signal },
			],
			[["openspec"], { timeoutMs: MAX_RUN_MS, cwd: "/worktrees/feature", signal }],
		]);
		for (const argv of [[], [""], "gh issue list", [1]] as unknown as string[][])
			await expect(
				actions.runInWorkspace({ workspaceId: "w1", argv, timeoutMs: 1_000 }),
			).rejects.toThrow("argv");
		await expect(
			actions.runInWorkspace({ workspaceId: "w1", argv: ["gh"], timeoutMs: 0 }),
		).rejects.toThrow("timeoutMs");
		await expect(
			actions.runInWorkspace({ workspaceId: "chat-1", argv: ["ls"], timeoutMs: 1_000 }),
		).rejects.toThrow("no worktree");
		expect(run).toHaveBeenCalledTimes(2);
	});

	test("runInWorkspace stops its program once the extension's services signal aborts", async () => {
		const controller = new AbortController();
		const { actions } = setup(
			{ run: liveActionDeps.run, workspaces: () => [{ ...feature, worktreePath: process.cwd() }] },
			controller.signal,
		);
		const pending = actions.runInWorkspace({
			workspaceId: "w1",
			argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
			timeoutMs: 60_000,
		});
		controller.abort();
		expect(await pending).toMatchObject({ ok: false, timedOut: false });
	});

	test("assist asks the host's one-shot path with a bounded prompt and the services' signal", async () => {
		const controller = new AbortController();
		const { actions, assist } = setup({}, controller.signal);
		expect(await actions.assist({ prompt: "  Size it  ", maxTokens: 16 })).toEqual({ text: "M" });
		expect(assist.mock.calls).toEqual([
			[{ prompt: "Size it", maxTokens: 16, signal: controller.signal }],
		]);
		await actions.assist({ prompt: "Again" });
		expect(assist.mock.calls[1]?.[0].maxTokens).toBe(256);
		await expect(actions.assist({ prompt: " " })).rejects.toThrow("non-empty prompt");
		await expect(actions.assist({ prompt: "x".repeat(20_001) })).rejects.toThrow("longer than");
		await expect(actions.assist({ prompt: "x", maxTokens: MAX_ASSIST_TOKENS + 1 })).rejects.toThrow(
			"maxTokens",
		);
		await expect(actions.assist({ prompt: "x", maxTokens: 1.5 })).rejects.toThrow("maxTokens");
		controller.abort();
		expect(await actions.assist({ prompt: "late" })).toBeNull();
		expect(assist).toHaveBeenCalledTimes(2);
	});

	test("assist answers null when the host has no model or no answer", async () => {
		const { actions } = setup({ assist: async () => null });
		expect(await actions.assist({ prompt: "Size it" })).toBeNull();
	});
});
