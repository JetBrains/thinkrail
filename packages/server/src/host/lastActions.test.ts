import { describe, expect, test } from "bun:test";
import type { PiEvent } from "@thinkrail/contracts";
import {
	COMMAND_TARGET_MAX,
	createLastActions,
	lastActionTarget,
	PATH_TARGET_MAX,
} from "./lastActions";

const ROOT = "/home/dana/.thinkrail/worktrees/app/workspace-1";
const HOME = "/home/dana";

const toolStart = (toolName: string, args: unknown): PiEvent => ({
	type: "tool_execution_start",
	toolCallId: `call-${toolName}`,
	toolName,
	args,
});

describe("a last action's target", () => {
	test("is the workspace-relative path of a read, edit or write inside the worktree", () => {
		expect(lastActionTarget("read", { path: "src/app.ts" }, ROOT, HOME)).toBe("src/app.ts");
		expect(lastActionTarget("edit", { path: `${ROOT}/src/app.ts` }, ROOT, HOME)).toBe("src/app.ts");
		expect(lastActionTarget("write", { path: "@docs/./notes/../a.md" }, ROOT, HOME)).toBe(
			"docs/a.md",
		);
	});

	test("never names a path outside the worktree, a home path or the worktree itself", () => {
		for (const path of [
			"/etc/passwd",
			"../secrets.txt",
			"src/../../other/a.ts",
			`${ROOT}-2/src/a.ts`,
			"~/.ssh/id_ed25519",
			`${HOME}/.aws/credentials`,
			ROOT,
			".",
			"",
		])
			expect(lastActionTarget("read", { path }, ROOT, HOME)).toBeUndefined();
		expect(lastActionTarget("read", { path: "src/a.ts" }, null, HOME)).toBeUndefined();
		expect(lastActionTarget("edit", { file: "a.ts" }, ROOT, HOME)).toBeUndefined();
	});

	test("keeps a long path's end within its bound", () => {
		const long = `${"deep/".repeat(40)}file.ts`;
		const target = lastActionTarget("read", { path: long }, ROOT, HOME) ?? "";
		expect(target.length).toBe(PATH_TARGET_MAX);
		expect(target.startsWith("…")).toBe(true);
		expect(target.endsWith("/file.ts")).toBe(true);
	});

	test("is the first characters of a bash command, on one line, the worktree and home shortened", () => {
		expect(lastActionTarget("bash", { command: "bun test\n  --watch" }, ROOT, HOME)).toBe(
			"bun test --watch",
		);
		expect(lastActionTarget("bash", { command: `cd ${ROOT} && ls ${ROOT}/src` }, ROOT, HOME)).toBe(
			"cd . && ls src",
		);
		expect(lastActionTarget("bash", { command: `cat ${HOME}/.npmrc` }, ROOT, HOME)).toBe(
			"cat ~/.npmrc",
		);
		expect(lastActionTarget("bash", { command: `ls ${ROOT}-2/x` }, ROOT, HOME)).toBe(
			"ls ~/.thinkrail/worktrees/app/workspace-1-2/x",
		);
		const target = lastActionTarget("bash", { command: "x".repeat(200) }, ROOT, HOME) ?? "";
		expect(target.length).toBe(COMMAND_TARGET_MAX);
		expect(target.endsWith("…")).toBe(true);
		expect(lastActionTarget("bash", { command: "   " }, ROOT, HOME)).toBeUndefined();
	});

	test("is omitted for every other tool", () => {
		for (const tool of ["grep", "ls", "find", "todo_write", "mcp__fs__read"])
			expect(lastActionTarget(tool, { path: "src/a.ts", command: "ls" }, ROOT, HOME)).toBe(
				undefined,
			);
		expect(lastActionTarget("read", null, ROOT, HOME)).toBeUndefined();
	});
});

describe("the last-action tracker", () => {
	function tracker(live: Set<string>) {
		let now = 100;
		return createLastActions({
			isLive: (sessionId) => live.has(sessionId),
			rootOf: (workspaceId) => (workspaceId === "w1" ? ROOT : null),
			now: () => ++now,
			home: HOME,
		});
	}

	test("keeps each live session's most recent tool start and ignores other events", () => {
		const live = new Set(["s1", "s2"]);
		const actions = tracker(live);
		expect(actions.get("s1")).toBeUndefined();
		actions.note("w1", "s1", toolStart("read", { path: "README.md" }));
		actions.note("w1", "s1", { type: "agent_settled", terminal: null });
		expect(actions.get("s1")).toEqual({ tool: "read", target: "README.md", at: 101 });
		actions.note("w1", "s1", toolStart("todo_write", { todos: [] }));
		expect(actions.get("s1")).toEqual({ tool: "todo_write", at: 102 });
		actions.note("w2", "s2", toolStart("edit", { path: "README.md" }));
		expect(actions.get("s2")).toEqual({ tool: "edit", at: 103 });
		expect(actions.get("s1")?.tool).toBe("todo_write");
	});

	test("drops a session once it is disposed or deleted", () => {
		const live = new Set(["s1", "s2", "s3"]);
		const actions = tracker(live);
		for (const id of ["s1", "s2", "s3"])
			actions.note("w1", id, toolStart("bash", { command: "ls" }));
		live.delete("s1");
		expect(actions.get("s1")).toBeUndefined();
		live.add("s1");
		expect(actions.get("s1")).toBeUndefined();
		live.delete("s2");
		actions.note("w1", "s3", toolStart("read", { path: "a.ts" }));
		live.add("s2");
		expect(actions.get("s2")).toBeUndefined();
		actions.forget("s3");
		expect(actions.get("s3")).toBeUndefined();
	});
});
