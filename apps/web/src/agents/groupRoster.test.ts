import { expect, test } from "bun:test";
import type { SubagentRosterRow } from "@thinkrail/contracts";
import { formatAgentElapsed, groupRoster, isStoppableAgent } from "./groupRoster";

const row = (id: string, status: SubagentRosterRow["status"]): SubagentRosterRow => ({
	childSessionId: id,
	parentSessionId: "p",
	parentTitle: "Chat",
	task: "t",
	status,
	createdAt: "2026-01-01T00:00:00.000Z",
});

test("failures lead; groups are state-first and empty groups are omitted", () => {
	const groups = groupRoster([
		row("a", "completed"),
		row("b", "running"),
		row("c", "error"),
		row("d", "queued"),
		row("e", "aborted"),
	]);
	expect(groups.map((g) => g.id)).toEqual(["failed", "working", "queued", "done"]);
	expect(groups[3]?.rows.map((r) => r.childSessionId)).toEqual(["a", "e"]);
});

test("only live rows are stoppable", () => {
	expect(isStoppableAgent(row("a", "running"))).toBe(true);
	expect(isStoppableAgent(row("a", "queued"))).toBe(true);
	expect(isStoppableAgent(row("a", "error"))).toBe(false);
});

test("elapsed formatting", () => {
	expect(formatAgentElapsed(12_000)).toBe("12s");
	expect(formatAgentElapsed(125_000)).toBe("2m");
	expect(formatAgentElapsed(3_900_000)).toBe("1h 5m");
});
