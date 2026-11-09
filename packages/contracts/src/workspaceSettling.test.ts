import { expect, test } from "bun:test";
import type { Workspace } from "./domain";
import { partitionWorkspaces } from "./workspaceSettling";

const DAY = 24 * 60 * 60_000;
const NOW = 100 * DAY;
const row = (id: string, extra: Partial<Workspace> = {}): Workspace => ({
	id,
	projectId: "p",
	name: id,
	branch: id,
	worktreePath: `/w/${id}`,
	baseBranch: "main",
	...extra,
});

test("Default stays first, idle and parked rows settle, a busy row never does", () => {
	const rows = [
		row("default", { kind: "default", lastActiveAt: 0 }),
		row("fresh", { lastActiveAt: NOW - DAY }),
		row("idle", { lastActiveAt: NOW - 30 * DAY }),
		row("parked", { settledOverride: "settled", settledAt: NOW - DAY }),
		row("busy", { lastActiveAt: NOW - 30 * DAY }),
	];
	const { live, settled } = partitionWorkspaces(rows, {
		now: NOW,
		settleIdleDays: 7,
		busy: (workspace) => workspace.id === "busy",
	});
	expect(live.map((workspace) => workspace.id)).toEqual(["default", "busy", "fresh"]);
	expect(settled.map(({ workspace, reason }) => [workspace.id, reason.kind])).toEqual([
		["parked", "override"],
		["idle", "idle"],
	]);
});
