import { describe, expect, test } from "bun:test";
import { RiChat2Line, RiGitBranchLine } from "@remixicon/react";
import type { PaletteItem } from "./model";
import {
	RECENT_WORKSPACE_LIMIT,
	type RecentWorkspacesState,
	rankRecentWorkspaces,
} from "./recentWorkspaces";

const item = (id: string): PaletteItem => ({
	id,
	kind: id.startsWith("chat:") ? "chat" : "workspace",
	title: id,
	group: id.startsWith("chat:") ? "chats" : "workspaces",
	scope: "work",
	icon: id.startsWith("chat:") ? RiChat2Line : RiGitBranchLine,
});

const state = (extra: Record<string, unknown> = {}) =>
	({
		activeWorkspaceId: "w1",
		workspaces: {
			p1: [
				{ id: "w1", projectId: "p1" },
				{ id: "w2", projectId: "p1" },
				{ id: "w3", projectId: "p1" },
				{ id: "gone", projectId: "p1", deletionPending: true },
			],
			chats: [{ id: "c1", projectId: "chats", kind: "chat" }],
		},
		sessionStateByWorkspace: { w2: { s2: {} }, c1: { s9: {} } },
		...extra,
	}) as unknown as RecentWorkspacesState;

const items = [
	"workspace:w1",
	"workspace:w2",
	"workspace:w3",
	"workspace:gone",
	"chat:s2",
	"chat:s9",
].map(item);

describe("rankRecentWorkspaces", () => {
	test("the current workspace leads, then visits newest first, a chat's visit counting for its workspace", () => {
		const ranked = rankRecentWorkspaces(items, state(), {
			"workspace:w1": 1,
			"workspace:w2": 2,
			"chat:s2": 5,
			"workspace:w3": 4,
			"chat:s9": 3,
			"workspace:gone": 9,
		});
		expect(ranked.rows.map((row) => row.id)).toEqual([
			"workspace:w1",
			"workspace:w2",
			"workspace:w3",
			"chat:s9",
		]);
		expect(ranked.currentId).toBe("workspace:w1");
	});

	test("unvisited workspaces and Project Home are left out, and the list is capped", () => {
		expect(rankRecentWorkspaces(items, state({ activeWorkspaceId: null }), {})).toEqual({
			rows: [],
			currentId: null,
		});
		const many = Array.from({ length: 15 }, (_, index) => ({ id: `m${index}`, projectId: "p1" }));
		const ranked = rankRecentWorkspaces(
			many.map((workspace) => item(`workspace:${workspace.id}`)),
			state({ activeWorkspaceId: null, workspaces: { p1: many }, sessionStateByWorkspace: {} }),
			Object.fromEntries(many.map((workspace, index) => [`workspace:${workspace.id}`, index])),
		);
		expect(ranked.rows).toHaveLength(RECENT_WORKSPACE_LIMIT);
		expect(ranked.rows[0]?.id).toBe("workspace:m14");
	});

	test("a workspace without a palette row is skipped, so a chat without a project and no prompt never shows", () => {
		const ranked = rankRecentWorkspaces(
			items.filter((row) => row.id !== "chat:s9"),
			state(),
			{ "chat:s9": 3 },
		);
		expect(ranked.rows.map((row) => row.id)).toEqual(["workspace:w1"]);
	});
});
