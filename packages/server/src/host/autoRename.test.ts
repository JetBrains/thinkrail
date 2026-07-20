import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, PiEvent } from "@thinkrail/contracts";
import { setOneShotRunner } from "../assist";
import { createWorkspace, listWorkspaces, removeWorkspace, renameWorkspace } from "../workspaces";
import {
	isPromptCommitted,
	isSettledTurn,
	maybeAutoRenameWorkspace,
	maybeNaiveNameWorkspace,
} from "./autoRename";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-rename-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
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
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
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

	expect(renamed?.name).toBe("Add Login Flow"); // display name (Title Case)
	expect(renamed?.branch).toBe("add-login-flow"); // derived kebab branch
	expect(renamed?.renamed).toBe(true);
	expect(renamed?.worktreePath).toBe(ws.worktreePath);
	expect(runner.calls()).toBe(1);
	expect(listWorkspaces("p1")[0]?.name).toBe("Add Login Flow");
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
	expect(retried?.name).toBe("Fix The Parser");
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

	expect(renamed?.name).toBe("Fix Header Layout");
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
	expect(listWorkspaces("p1")[0]?.name).toBe("user picked this");
});

test("naive-rename names the workspace instantly from the first prompt, provisionally", async () => {
	const ws = await createWorkspace("p1");

	const named = await maybeNaiveNameWorkspace("s1", ws.id, firstTurn);

	// Bounded Title Case name from "add a login form to the settings page" (5-word cap); branch derived.
	expect(named?.name).toBe("Add A Login Form To");
	expect(named?.branch).toBe("add-a-login-form-to");
	expect(named?.worktreePath).toBe(ws.worktreePath); // dir never moves
	// Provisional: `renamed` stays unset so the agentic pass still refines it.
	expect(named?.renamed).toBeUndefined();
	expect(listWorkspaces("p1")[0]?.renamed).toBeUndefined();
});

test("naive-rename fires only while the name is pristine (workspace-N)", async () => {
	const ws = await createWorkspace("p1");
	await maybeNaiveNameWorkspace("s1", ws.id, firstTurn);

	// Second turn start: the branch is no longer `workspace-N`, so it never re-fires.
	expect(await maybeNaiveNameWorkspace("s1", ws.id, firstTurn)).toBeNull();
	expect(listWorkspaces("p1")[0]?.name).toBe("Add A Login Form To");
});

test("naive-rename never touches a user-named workspace", async () => {
	const ws = await createWorkspace("p1", "chosen name");

	expect(await maybeNaiveNameWorkspace("s1", ws.id, firstTurn)).toBeNull();
	expect(listWorkspaces("p1")[0]?.name).toBe("chosen name");
});

test("the agentic pass refines a provisional naive name and locks it", async () => {
	const ws = await createWorkspace("p1");
	fakeRunner("Add Login Flow");

	const provisional = await maybeNaiveNameWorkspace("s1", ws.id, firstTurn);
	expect(provisional?.name).toBe("Add A Login Form To");
	expect(provisional?.renamed).toBeUndefined();

	// Settled turn: the agentic namer still runs (renamed was unset) and upgrades + locks.
	const refined = await maybeAutoRenameWorkspace("s1", ws.id, firstTurn);
	expect(refined?.name).toBe("Add Login Flow");
	expect(refined?.renamed).toBe(true);

	// And the now-locked name is inert to a further turn start.
	expect(await maybeNaiveNameWorkspace("s1", ws.id, firstTurn)).toBeNull();
	expect(listWorkspaces("p1")[0]?.name).toBe("Add Login Flow");
});

test("naive-rename resolves null when the first prompt is blank or unusable", async () => {
	const ws = await createWorkspace("p1");
	const punctOnly = async (): Promise<Message[]> => [user("!!! ??? ..."), assistant("hm")];

	expect(await maybeNaiveNameWorkspace("s1", ws.id, punctOnly)).toBeNull();
	expect(listWorkspaces("p1")[0]?.name).toBe("workspace-1");
	expect(await maybeNaiveNameWorkspace("s1", ws.id, async () => [])).toBeNull();
});

test("isPromptCommitted: only a user message_end has the prompt in the transcript", () => {
	expect(
		isPromptCommitted({ type: "message_end", message: { role: "user" } } as unknown as PiEvent),
	).toBe(true);
	// An assistant message_end is not the prompt; agent_start/turn_start fire before the prompt lands.
	expect(
		isPromptCommitted({
			type: "message_end",
			message: { role: "assistant" },
		} as unknown as PiEvent),
	).toBe(false);
	expect(isPromptCommitted({ type: "agent_start" } as PiEvent)).toBe(false);
	expect(isPromptCommitted({ type: "turn_start" } as PiEvent)).toBe(false);
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

	expect(a?.name).toBe("Slow Name");
	expect(b).toBeNull();
	expect(calls).toBe(1);
});
