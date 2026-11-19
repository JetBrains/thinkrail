import { describe, expect, test } from "bun:test";
import type { LayoutPresetSideRegion } from "@thinkrail/contracts";
import { validateLayoutDocument } from "./model";
import { collectWorkbenchCenterGroups, projectWorkspaceLayout } from "./normalized";
import {
	applyWorkbenchSides,
	BUILTIN_LAYOUT_PRESETS,
	captureWorkbenchPreset,
	instantiateWorkbenchFrame,
} from "./presets";

const BOARD_SIDES: { left: LayoutPresetSideRegion; right: LayoutPresetSideRegion } = {
	left: {
		visible: true,
		width: 0.6,
		groups: [
			{ id: "board-projects", weight: 0.1, folded: true, tools: ["projects"] },
			{ id: "board-board", weight: 0.9, folded: false, tools: ["ext:board:board"] },
		],
	},
	right: { visible: false, width: 0.28, groups: [] },
};

function balanced() {
	const preset = BUILTIN_LAYOUT_PRESETS.find((candidate) => candidate.id === "balanced");
	if (!preset) throw new Error("missing Balanced");
	const frame = instantiateWorkbenchFrame(preset);
	const [center] = collectWorkbenchCenterGroups(frame.center);
	const [bottom] = frame.bottom.groups;
	if (!center || !bottom) throw new Error("missing groups");
	const view = {
		groups: {
			[center.id]: {
				tabs: [
					{ kind: "chat" as const, id: "chat-1", name: "Chat", sessionId: "s1" },
					{ kind: "file" as const, id: "a.ts", name: "a.ts", path: "a.ts" },
				],
			},
			[bottom.id]: {
				tabs: [{ kind: "terminal" as const, id: "term", name: "term", tabKey: "term" }],
			},
		},
	};
	return { frame, view, center: center.id, bottom: bottom.id };
}

describe("a layout mode's sides", () => {
	test("replace the left and right while the center and the bottom keep their groups and tabs", () => {
		const { frame, view, center, bottom } = balanced();
		const next = applyWorkbenchSides({ frame, viewsByWorkspace: { A: view } }, BOARD_SIDES);
		expect(next.frame.center).toBe(frame.center);
		expect(next.viewsByWorkspace.A).toBe(view);
		expect(next.frame.bottom.groups.map((group) => group.id)).toEqual([bottom]);
		expect(next.viewsByWorkspace.A?.groups[center]?.tabs.map((tab) => tab.id)).toEqual([
			"chat-1",
			"a.ts",
		]);
		expect(next.viewsByWorkspace.A?.groups[bottom]?.tabs.map((tab) => tab.id)).toEqual(["term"]);
		expect(
			next.frame.left.groups.map(({ folded, weight, tools }) => [
				folded,
				weight,
				tools.map((tool) => tool.tool),
			]),
		).toEqual([
			[true, 0.1, ["projects"]],
			[false, 0.9, ["ext:board:board"]],
		]);
		expect(next.frame.left.groups.map((group) => group.id)).not.toContain("board-board");
		expect(next.frame.left.width).toBe(0.6);
		expect(next.frame.right).toEqual({ visible: false, width: 0.28, groups: [] });
		const [projects] = frame.left.groups[0]?.tools ?? [];
		expect(next.frame.left.groups[0]?.tools[0]).toBe(projects);
		const rightTop = frame.right.groups[0]?.id;
		if (!rightTop) throw new Error("missing Balanced's right group");
		expect(next.frame.toolRestoreTargets.files).toEqual({
			region: "right",
			groupId: rightTop,
			index: 1,
		});
		expect(next.frame.toolRestoreTargets["ext:board:board"]).toBeUndefined();
		expect(next.frame.toolRestoreTargets.projects).toBeUndefined();
		const document = projectWorkspaceLayout(next.frame, next.viewsByWorkspace.A ?? view);
		expect(validateLayoutDocument(document, 6, 3)).toEqual([]);
	});

	test("restoring the captured sides with their targets gives the exact frame back", () => {
		const { frame, view } = balanced();
		const captured = captureWorkbenchPreset(frame, "board:board", "board:board");
		const entered = applyWorkbenchSides({ frame, viewsByWorkspace: { A: view } }, BOARD_SIDES);
		const left = applyWorkbenchSides(entered, captured, {
			keepGroupIds: true,
			restoreTargets: frame.toolRestoreTargets,
		});
		expect(left.frame).toEqual(frame);
		expect(left.viewsByWorkspace.A).toBe(view);
	});

	test("rehome a terminal that sat in a replaced side group", () => {
		const { frame, view, bottom } = balanced();
		const [leftGroup] = frame.left.groups;
		if (!leftGroup) throw new Error("missing Balanced's left group");
		const terminalPane = {
			...frame,
			left: {
				...frame.left,
				groups: [
					{ ...leftGroup, weight: 0.5 },
					{ id: "left-terminals", weight: 0.5, folded: false, tools: [] },
				],
			},
		};
		const withTerminal = {
			groups: {
				...view.groups,
				"left-terminals": {
					tabs: [{ kind: "terminal" as const, id: "side-term", name: "t", tabKey: "side-term" }],
				},
			},
		};
		const next = applyWorkbenchSides(
			{ frame: terminalPane, viewsByWorkspace: { A: withTerminal } },
			BOARD_SIDES,
		);
		expect(next.viewsByWorkspace.A?.groups["left-terminals"]).toBeUndefined();
		expect(next.viewsByWorkspace.A?.groups[bottom]?.tabs.map((tab) => tab.id).sort()).toEqual([
			"side-term",
			"term",
		]);
	});

	test("take a tool the sides place out of a bottom tool group, dropping a group left empty", () => {
		const { frame } = balanced();
		const withBottomTool = {
			...frame,
			right: { ...frame.right, groups: frame.right.groups.slice(1) },
			bottom: {
				...frame.bottom,
				groups: [
					...frame.bottom.groups.map((group) => ({ ...group, weight: 0.5 })),
					{
						id: "bottom-tools",
						weight: 0.5,
						folded: false,
						tools: frame.right.groups[0]?.tools.slice(0, 1) ?? [],
					},
				],
			},
		};
		const placesSpecs = {
			...BOARD_SIDES,
			right: {
				visible: true,
				width: 0.2,
				groups: [{ id: "r", weight: 1, folded: false, tools: ["specs" as const] }],
			},
		};
		const next = applyWorkbenchSides({ frame: withBottomTool, viewsByWorkspace: {} }, placesSpecs);
		expect(next.frame.bottom.groups.map(({ id, weight }) => [id, weight])).toEqual([
			[frame.bottom.groups[0]?.id ?? "", 1],
		]);
		expect(next.frame.right.groups[0]?.tools.map((tool) => tool.tool)).toEqual(["specs"]);
	});
});
