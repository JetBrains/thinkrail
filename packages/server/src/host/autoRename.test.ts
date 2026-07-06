import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, PiEvent } from "@thinkrail-pi/contracts";
import { setOneShotRunner } from "../assist";
import { createWorkspace, listWorkspaces, removeWorkspace, renameWorkspace } from "../workspaces";
import { isSettledTurn, maybeAutoRenameWorkspace } from "./autoRename";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_PI_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-rename-test-"));
	process.env.THINKRAIL_PI_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
});

afterEach(() => {
	setOneShotRunner(null);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_PI_DATA_DIR;
	else process.env.THINKRAIL_PI_DATA_DIR = savedDataDir;
});

function user(text: string): Message {
	return { role: "user", content: text, timestamp: 0 } as Message;
}

function assistant(text: string, stopReason = "stop"): Message {
	return { role: "assistant", content: [{ type: "text", text }], stopReason } as unknown as Message;
}

const firstTurn = async (): Promise<Message[]> => [
	user("add a login form to the settings page"),
	assistant("Done — added the form."),
];

/** A runner fake returning `text`, counting invocations and capturing the prompts it was fed. */
function fakeRunner(text: string): { calls: () => number; prompts: string[] } {
	let calls = 0;
	const prompts: string[] = [];
	setOneShotRunner(async (req) => {
		calls += 1;
		prompts.push(req.prompt);
		return { text, model: { provider: "test", id: "fake" } };
	});
	return { calls: () => calls, prompts };
}

test("renames the workspace off the first settled turn and flags it", async () => {
	const ws = await createWorkspace("p1");
	const runner = fakeRunner("Add Login Flow");

	const renamed = await maybeAutoRenameWorkspace("s1", ws.id, firstTurn);

	expect(renamed?.name).toBe("add-login-flow");
	expect(renamed?.branch).toBe("add-login-flow");
	expect(renamed?.renamed).toBe(true);
	expect(renamed?.worktreePath).toBe(ws.worktreePath);
	expect(runner.calls()).toBe(1);
	expect(listWorkspaces("p1")[0]?.name).toBe("add-login-flow");
});

test("a renamed workspace is never touched again", async () => {
	const ws = await createWorkspace("p1");
	const runner = fakeRunner("Add Login Flow");
	await maybeAutoRenameWorkspace("s1", ws.id, firstTurn);

	expect(await maybeAutoRenameWorkspace("s1", ws.id, firstTurn)).toBeNull();
	expect(runner.calls()).toBe(1);
});

test("a user-named workspace never invokes the namer", async () => {
	const ws = await createWorkspace("p1", "chosen name");
	const runner = fakeRunner("Something Else");

	expect(await maybeAutoRenameWorkspace("s1", ws.id, firstTurn)).toBeNull();
	expect(runner.calls()).toBe(0);
});

test("a failed suggestion leaves the flag unset so a later turn retries", async () => {
	const ws = await createWorkspace("p1");
	fakeRunner("!!! ???"); // slugs to nothing → suggestion degrades to null

	expect(await maybeAutoRenameWorkspace("s1", ws.id, firstTurn)).toBeNull();
	expect(listWorkspaces("p1")[0]?.renamed).toBeUndefined();

	fakeRunner("Fix The Parser");
	const retried = await maybeAutoRenameWorkspace("s1", ws.id, firstTurn);
	expect(retried?.name).toBe("fix-the-parser");
});

test("a throwing runner degrades to null", async () => {
	const ws = await createWorkspace("p1");
	setOneShotRunner(async () => {
		throw new Error("no-model");
	});

	expect(await maybeAutoRenameWorkspace("s1", ws.id, firstTurn)).toBeNull();
	expect(listWorkspaces("p1")[0]?.renamed).toBeUndefined();
});

test("an errored or aborted run never names the workspace", async () => {
	const ws = await createWorkspace("p1");
	const runner = fakeRunner("Add Login Flow");

	const errored = async (): Promise<Message[]> => [user("do a thing"), assistant("", "error")];
	expect(await maybeAutoRenameWorkspace("s1", ws.id, errored)).toBeNull();

	const aborted = async (): Promise<Message[]> => [user("do a thing"), assistant("", "aborted")];
	expect(await maybeAutoRenameWorkspace("s1", ws.id, aborted)).toBeNull();
	expect(runner.calls()).toBe(0);
});

test("a retracted first prompt is never naming material — the first clean turn is", async () => {
	const ws = await createWorkspace("p1");
	const runner = fakeRunner("Fix Header Layout");

	// Turn 1 was aborted (wrong workspace); turn 2 is the real task and settles cleanly.
	const transcript = async (): Promise<Message[]> => [
		user("refactor the billing engine"),
		assistant("Starting on billing…", "aborted"),
		user("fix the header layout"),
		assistant("Done — header fixed."),
	];
	const renamed = await maybeAutoRenameWorkspace("s1", ws.id, transcript);

	expect(renamed?.name).toBe("fix-header-layout");
	expect(runner.prompts[0]).toContain("fix the header layout");
	expect(runner.prompts[0]).not.toContain("billing");
});

test("a workspace archived during the one-shot is not renamed or resurrected", async () => {
	const ws = await createWorkspace("p1");
	let release = (): void => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	setOneShotRunner(async () => {
		await gate;
		return { text: "Too Late", model: { provider: "test", id: "fake" } };
	});

	const pending = maybeAutoRenameWorkspace("s1", ws.id, firstTurn);
	removeWorkspace(ws.id);
	release();

	expect(await pending).toBeNull();
	expect(listWorkspaces("p1")).toHaveLength(0);
});

test("a user rename landing during the one-shot wins; the late suggestion is dropped", async () => {
	const ws = await createWorkspace("p1");
	let release = (): void => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	setOneShotRunner(async () => {
		await gate;
		return { text: "Too Late", model: { provider: "test", id: "fake" } };
	});

	const pending = maybeAutoRenameWorkspace("s1", ws.id, firstTurn);
	renameWorkspace(ws.id, "user picked this");
	release();

	expect(await pending).toBeNull();
	expect(listWorkspaces("p1")[0]?.name).toBe("user-picked-this");
});

test("isSettledTurn: only a no-retry agent_end settles a turn", () => {
	expect(isSettledTurn({ type: "agent_end", messages: [], willRetry: false } as PiEvent)).toBe(
		true,
	);
	expect(isSettledTurn({ type: "agent_end", messages: [], willRetry: true } as PiEvent)).toBe(
		false,
	);
	expect(isSettledTurn({ type: "turn_start" } as PiEvent)).toBe(false);
	expect(isSettledTurn({ type: "agent_start" } as PiEvent)).toBe(false);
});

test("a transcript without a user prompt never invokes the namer", async () => {
	const ws = await createWorkspace("p1");
	const runner = fakeRunner("Add Login Flow");

	expect(await maybeAutoRenameWorkspace("s1", ws.id, async () => [])).toBeNull();
	expect(runner.calls()).toBe(0);
});

test("an unknown workspace resolves null", async () => {
	fakeRunner("Add Login Flow");
	expect(await maybeAutoRenameWorkspace("s1", "nope", firstTurn)).toBeNull();
});

test("concurrent settling turns dedupe to one attempt", async () => {
	const ws = await createWorkspace("p1");
	let release = (): void => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let calls = 0;
	setOneShotRunner(async () => {
		calls += 1;
		await gate;
		return { text: "Slow Name", model: { provider: "test", id: "fake" } };
	});

	const first = maybeAutoRenameWorkspace("s1", ws.id, firstTurn);
	const second = maybeAutoRenameWorkspace("s2", ws.id, firstTurn);
	release();
	const [a, b] = await Promise.all([first, second]);

	expect(a?.name).toBe("slow-name");
	expect(b).toBeNull();
	expect(calls).toBe(1);
});
