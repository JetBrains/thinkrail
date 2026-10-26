import { expect, test } from "bun:test";
import type { BackgroundCommandSummary, SubagentResourceSummary } from "@thinkrail/contracts";
import { freshOf, inspectedResult, rememberSeen, resultTargetKey } from "./useFreshResults";

const command: BackgroundCommandSummary = {
	id: "cmd",
	sessionId: "chat",
	name: "tests",
	command: "bun test",
	status: "completed",
	startedAt: 0,
	finishedAt: 1,
	exitCode: 0,
};
const child: SubagentResourceSummary = {
	childSessionId: "child",
	parentSessionId: "chat",
	task: "review",
	status: "completed",
	createdAt: new Date(0).toISOString(),
	detached: true,
};

test("a finished result is new until its key is seen, and nothing is new before a baseline exists", () => {
	const finished = { finishedCommands: [command], finishedSubagents: [child] };
	expect(freshOf(finished, null)).toEqual({ commands: [], subagents: [] });
	expect(freshOf(finished, new Set())).toEqual({ commands: [command], subagents: [child] });
	expect(freshOf(finished, new Set([resultTargetKey({ kind: "command", id: "cmd" })]))).toEqual({
		commands: [],
		subagents: [child],
	});
	expect(resultTargetKey({ kind: "subagent", childSessionId: "child" })).toBe("subagent:child");
});

test("opening a result in the inspector counts only once it has finished", () => {
	const finished = { finishedCommands: [command], finishedSubagents: [child] };
	expect(inspectedResult(finished, "cmd", null)).toEqual({ kind: "command", id: "cmd" });
	expect(inspectedResult(finished, null, "child")).toEqual({
		kind: "subagent",
		childSessionId: "child",
	});
	expect(inspectedResult(finished, "still-running", null)).toBeNull();
	expect(inspectedResult(finished, null, null)).toBeNull();
});

test("acknowledging before the first snapshot keeps the first-visit baseline pending", () => {
	expect(rememberSeen(null, ["command:cmd"], false)).toBeNull();
	expect(rememberSeen(null, ["command:cmd"], true)).toEqual(new Set(["command:cmd"]));
	expect(rememberSeen(new Set(["a"]), ["b"], false)).toEqual(new Set(["a", "b"]));
	expect(rememberSeen(new Set(["a"]), ["b"], true)).toEqual(new Set(["b"]));
});

test("a foreground subagent is never a new result: the agent's card already delivered it", () => {
	const foreground: SubagentResourceSummary = {
		...child,
		childSessionId: "fg",
		detached: undefined,
	};
	const finished = { finishedCommands: [], finishedSubagents: [child, foreground] };
	expect(freshOf(finished, new Set()).subagents).toEqual([child]);
});
