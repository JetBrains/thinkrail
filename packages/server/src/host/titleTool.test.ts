import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@thinkrail/contracts";
import {
	createWorkspace,
	getWorkspace,
	listWorkspaces,
	renameWorkspace,
	syncWorkspaceBranch,
} from "../workspaces";
import { type AgentTitleDeps, applyAgentTitle } from "./titleTool";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = realpathSync(mkdtempSync(join(tmpdir(), "trpi-title-test-")));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	git(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function fakeChat(workspaceId: string | undefined, named = false) {
	const writes: Array<{ title: string; onlyIfUnnamed: boolean | undefined }> = [];
	let current: string | undefined = named ? "Manual title" : undefined;
	const deps: AgentTitleDeps = {
		workspaceOf: () => workspaceId,
		writeChatTitle: async (_sessionId, _workspaceId, _cwd, title, options = {}) => {
			writes.push({ title, onlyIfUnnamed: options.onlyIfUnnamed });
			if (options.onlyIfUnnamed && current !== undefined) return false;
			current = title;
			return true;
		},
	};
	return { deps, writes };
}

test("names an unnamed chat and workspace once: any-script name, English branch, locked", async () => {
	const ws = await createWorkspace("p1");
	const chat = fakeChat(ws.id);

	const text = await applyAgentTitle(
		"s1",
		{
			chat_title: "Ревью #567 Add page zoom shortcuts",
			workspace_name: "Ревью #567 Add page zoom shortcuts",
			branch: "review-567-page-zoom",
		},
		chat.deps,
	);

	expect(chat.writes).toEqual([
		{ title: "Ревью #567 Add page zoom shortcuts", onlyIfUnnamed: true },
	]);
	expect(getWorkspace(ws.id)).toMatchObject({
		name: "Ревью #567 Add page zoom shortcuts",
		branch: "review-567-page-zoom",
		renamed: true,
	});
	expect(text).toContain('Chat title set to "Ревью #567 Add page zoom shortcuts".');
	expect(text).toContain("branch review-567-page-zoom");

	const again = await applyAgentTitle(
		"s1",
		{ chat_title: "Something else", workspace_name: "Something else", branch: "something-else" },
		chat.deps,
	);
	expect(again).toContain("Chat title kept");
	expect(again).toContain("Workspace name kept: this workspace is already named.");
	expect(getWorkspace(ws.id).name).toBe("Ревью #567 Add page zoom shortcuts");
});

test("a manual rename always wins over the agent", async () => {
	const ws = await createWorkspace("p1");
	renameWorkspace(ws.id, "Mine");
	const chat = fakeChat(ws.id, true);

	const text = await applyAgentTitle(
		"s1",
		{ chat_title: "Agent title", workspace_name: "Agent name", branch: "agent-name" },
		chat.deps,
	);

	expect(text).toBe(
		"Chat title kept: this chat is already named.\nWorkspace name kept: this workspace is already named.",
	);
	expect(getWorkspace(ws.id)).toMatchObject({ name: "Mine", branch: ws.branch });
});

test.each([
	["before", true],
	["after", false],
])("the agent names a workspace whose terminal checked out a branch (nudge %s naming), but never moves that branch", async (_order, nudged) => {
	const ws = await createWorkspace("p1");
	git(ws.worktreePath, "switch", "-c", "feature/mine");
	if (nudged) syncWorkspaceBranch(ws.id);
	const refs = () =>
		Bun.spawnSync(["git", "-C", repo, "for-each-ref", "--format=%(refname:short)", "refs/heads"])
			.stdout.toString()
			.trim();
	const before = refs();

	const text = await applyAgentTitle(
		"s1",
		{ chat_title: "Agent title", workspace_name: "Agent name", branch: "agent-name" },
		fakeChat(ws.id).deps,
	);

	expect(text).toContain(
		'Workspace renamed to "Agent name" (branch feature/mine unchanged: it was checked out in this worktree outside ThinkRail. To rename the branch, call set_title again with workspace_name and branch after HEAD is back on the workspace\'s own branch).',
	);
	expect(getWorkspace(ws.id)).toMatchObject({
		name: "Agent name",
		branch: "feature/mine",
		renamed: true,
	});
	expect(refs()).toBe(before);
});

test("a detached HEAD still names the workspace and says the branch was kept", async () => {
	const ws = await createWorkspace("p1");
	git(ws.worktreePath, "switch", "--detach");

	const text = await applyAgentTitle(
		"s1",
		{ chat_title: "Agent title", workspace_name: "Agent name", branch: "agent-name" },
		fakeChat(ws.id).deps,
	);

	expect(text).toContain(
		`Workspace renamed to "Agent name" (branch ${ws.branch} unchanged: HEAD is detached or unreadable. To rename the branch, call set_title again with workspace_name and branch after HEAD is back on the workspace's own branch).`,
	);
	expect(getWorkspace(ws.id)).toMatchObject({
		name: "Agent name",
		branch: ws.branch,
		renamed: true,
		branchNamePending: "s1",
	});
});

test("a kept branch moves on a later call from the same chat once HEAD is back on the own branch", async () => {
	const ws = await createWorkspace("p1");
	const chat = fakeChat(ws.id);
	git(ws.worktreePath, "switch", "-c", "peek");
	await applyAgentTitle(
		"s1",
		{ chat_title: "Agent title", workspace_name: "First", branch: "first" },
		chat.deps,
	);
	git(ws.worktreePath, "switch", ws.branch);
	expect(await applyAgentTitle("s1", { chat_title: "Again" }, chat.deps)).toContain(
		"Chat title kept",
	);

	const text = await applyAgentTitle(
		"s1",
		{ workspace_name: "Second", branch: "second" },
		chat.deps,
	);

	expect(text).toBe('Workspace name kept as "First" (branch second).');
	const after = getWorkspace(ws.id);
	expect(after).toMatchObject({ name: "First", branch: "second", renamed: true });
	expect(after.branchNamePending).toBeUndefined();
	expect(await applyAgentTitle("s1", { workspace_name: "Third", branch: "third" }, chat.deps)).toBe(
		"Workspace name kept: this workspace is already named.",
	);
});

test("a kept branch never moves for another chat or after a manual rename", async () => {
	const ws = await createWorkspace("p1");
	git(ws.worktreePath, "switch", "-c", "peek");
	await applyAgentTitle(
		"s1",
		{ chat_title: "Agent title", workspace_name: "First", branch: "first" },
		fakeChat(ws.id).deps,
	);
	git(ws.worktreePath, "switch", ws.branch);
	const later = { chat_title: "Later chat", workspace_name: "Other task", branch: "other-task" };

	expect(await applyAgentTitle("s2", later, fakeChat(ws.id).deps)).toBe(
		'Chat title set to "Later chat".\nWorkspace name kept: this workspace is already named.',
	);
	renameWorkspace(ws.id, "User picked");
	expect(getWorkspace(ws.id).branchNamePending).toBeUndefined();
	expect(await applyAgentTitle("s1", later, fakeChat(ws.id, true).deps)).toBe(
		"Chat title kept: this chat is already named.\nWorkspace name kept: this workspace is already named.",
	);
	expect(getWorkspace(ws.id)).toMatchObject({ name: "User picked", branch: ws.branch });
});

test("the Default workspace keeps its name while the chat still gets one", async () => {
	const def = (await listWorkspaces("p1")).find((w): w is Workspace => w.kind === "default");
	if (!def) throw new Error("expected a Default workspace");
	const chat = fakeChat(def.id);

	const text = await applyAgentTitle(
		"s1",
		{ chat_title: "Fix login", workspace_name: "Fix login" },
		chat.deps,
	);

	expect(text).toContain('Chat title set to "Fix login".');
	expect(text).toContain("Workspace name kept: this workspace is not renamable.");
	expect(getWorkspace(def.id).name).toBe(def.name);
});

test("long names clamp at a word boundary; a missing slug keeps the branch", async () => {
	const ws = await createWorkspace("p1");
	const chat = fakeChat(ws.id);
	const long = "Review #9 ".concat("word ".repeat(30)).trim();

	await applyAgentTitle("s1", { chat_title: long, workspace_name: long }, chat.deps);

	const title = chat.writes[0]?.title ?? "";
	expect(title.length).toBeLessThanOrEqual(80);
	expect(title.endsWith("word")).toBe(true);
	const named = getWorkspace(ws.id);
	expect(named.name.length).toBeLessThanOrEqual(60);
	expect(named.name.endsWith("word")).toBe(true);
	expect(named.branch).toBe(ws.branch);
});

test("a branch without workspace_name is rejected before anything is written", async () => {
	const ws = await createWorkspace("p1");
	const chat = fakeChat(ws.id);

	await expect(
		applyAgentTitle("s1", { chat_title: "Fix login", branch: "fix-login" }, chat.deps),
	).rejects.toThrow("pass it together with workspace_name");

	expect(chat.writes).toEqual([]);
	expect(getWorkspace(ws.id)).toMatchObject({ name: ws.name, branch: ws.branch });
	expect(getWorkspace(ws.id).renamed).toBeUndefined();
});

test("a chat-only call on an unnamed workspace is rejected before anything is written", async () => {
	const ws = await createWorkspace("p1");
	const chat = fakeChat(ws.id);
	await expect(applyAgentTitle("s1", { chat_title: "Fix login" }, chat.deps)).rejects.toThrow(
		"pass chat_title, workspace_name and branch together in one call",
	);
	expect(chat.writes).toEqual([]);
	expect(getWorkspace(ws.id).renamed).toBeUndefined();

	renameWorkspace(ws.id, "Mine");
	const named = await applyAgentTitle("s2", { chat_title: "Other" }, fakeChat(ws.id).deps);
	expect(named).toBe('Chat title set to "Other".');
});

test("rejects calls from sessions the host does not manage, and empty names", async () => {
	await expect(
		applyAgentTitle("child", { chat_title: "x" }, fakeChat(undefined).deps),
	).rejects.toThrow("only available in a top-level chat");
	const ws = await createWorkspace("p1");
	await expect(
		applyAgentTitle("s1", { chat_title: "  ", workspace_name: "!!" }, fakeChat(ws.id).deps),
	).rejects.toThrow("Pass chat_title and/or workspace_name.");
});
