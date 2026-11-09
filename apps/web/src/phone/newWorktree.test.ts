import { expect, test } from "bun:test";
import type { WireModel, Workspace } from "@thinkrail/contracts";
import { baseBranches, startWorktree, WorktreeStartError } from "./newWorktree";

const workspace = {
	id: "ws-1",
	projectId: "p1",
	name: "ws",
	kind: "worktree",
} as unknown as Workspace;
const opus = { provider: "anthropic", id: "opus", name: "Opus" } as unknown as WireModel;

function fakeHost(fail: Partial<Record<string, string>> = {}) {
	const calls: [string, unknown][] = [];
	const request = async <T>(method: string, params: unknown): Promise<T> => {
		calls.push([method, params]);
		const reason = fail[method];
		if (reason) throw new Error(reason);
		if (method === "workspace.create") return workspace as T;
		if (method === "session.create")
			return { sessionId: "s1", model: opus, thinkingLevel: "high" } as T;
		return { ok: true } as T;
	};
	return { calls, request };
}

test("creates off the chosen base, starts the chat with the picked model, then sends the task", async () => {
	const host = fakeHost();
	const started = await startWorktree(host.request, {
		projectId: "p1",
		baseRef: "release",
		model: { model: opus, thinkingLevel: "high" },
		prompt: "  fix the login bug  ",
	});
	expect(host.calls).toEqual([
		["workspace.create", { projectId: "p1", baseRef: "release" }],
		["session.create", { workspaceId: "ws-1", model: opus, thinkingLevel: "high" }],
		["session.prompt", { sessionId: "s1", text: "fix the login bug" }],
	]);
	expect(started.workspace).toBe(workspace);
	expect(started.chat.sessionId).toBe("s1");
	expect(started.promptError).toBeNull();
});

test("untouched choices follow the computer: no base, no model, no first message", async () => {
	const host = fakeHost();
	await startWorktree(host.request, { projectId: "p1", baseRef: null, model: null, prompt: " " });
	expect(host.calls).toEqual([
		["workspace.create", { projectId: "p1" }],
		["session.create", { workspaceId: "ws-1" }],
	]);
});

test("a failed create reports the create step and leaves nothing behind", async () => {
	const host = fakeHost({ "workspace.create": "not a git repo" });
	const error = await startWorktree(host.request, {
		projectId: "p1",
		baseRef: null,
		model: null,
		prompt: "x",
	}).catch((e: unknown) => e);
	expect(error).toBeInstanceOf(WorktreeStartError);
	expect((error as WorktreeStartError).step).toBe("create");
	expect((error as WorktreeStartError).workspace).toBeNull();
	expect(host.calls).toHaveLength(1);
});

test("a failed chat start names the worktree that was made", async () => {
	const host = fakeHost({ "session.create": "no model" });
	const error = (await startWorktree(host.request, {
		projectId: "p1",
		baseRef: null,
		model: null,
		prompt: "x",
	}).catch((e: unknown) => e)) as WorktreeStartError;
	expect(error.step).toBe("chat");
	expect(error.workspace).toBe(workspace);
});

test("a first message that does not go still opens the chat, with the reason", async () => {
	const host = fakeHost({ "session.prompt": "busy" });
	const started = await startWorktree(host.request, {
		projectId: "p1",
		baseRef: null,
		model: null,
		prompt: "x",
	});
	expect(started.chat.sessionId).toBe("s1");
	expect(started.promptError).toBe("busy");
});

test("base branches: the default first, then other local ones, then remote-only ones", () => {
	expect(
		baseBranches({
			defaultBranch: "main",
			local: ["feature", "main"],
			remote: ["main", "feature", "origin-only"],
		}),
	).toEqual(["main", "feature", "origin-only"]);
});
