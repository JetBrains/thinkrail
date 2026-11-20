import { describe, expect, test } from "bun:test";
import { validateLayoutDocument } from "./model";
import { collectWorkbenchCenterGroups, projectWorkspaceLayout } from "./normalized";
import {
	arrangeWorkbenchView,
	BUILTIN_LAYOUT_PRESETS,
	captureWorkbenchSides,
	instantiateWorkbenchFrame,
	restoreWorkbenchSides,
	type WorkbenchViewArrangement,
} from "./presets";

const BOARD_VIEW: WorkbenchViewArrangement = {
	left: "ext:board:nav",
	bottom: "ext:board:activity",
	leftWidth: 0.16,
	bottomHeight: 0.26,
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

describe("an extension view's arrangement", () => {
	test("leads the left and the bottom with the view's tools and folds what they held, the center untouched", () => {
		const { frame, view, center, bottom } = balanced();
		const next = arrangeWorkbenchView({ frame, viewsByWorkspace: { A: view } }, BOARD_VIEW);
		expect(next.frame.center).toBe(frame.center);
		expect(next.viewsByWorkspace.A).toBe(view);
		expect(next.viewsByWorkspace.A?.groups[center]?.tabs.map((tab) => tab.id)).toEqual([
			"chat-1",
			"a.ts",
		]);
		expect(
			next.frame.left.groups.map(({ folded, tools }) => [folded, tools.map((tool) => tool.tool)]),
		).toEqual([
			[false, ["ext:board:nav"]],
			[true, ["projects"]],
		]);
		expect(next.frame.left.groups[1]?.id).toBe(frame.left.groups[0]?.id);
		expect(next.frame.left.groups[1]?.tools[0]).toBe(frame.left.groups[0]?.tools[0]);
		expect(next.frame.left).toMatchObject({ visible: true, width: 0.16 });
		expect(next.frame.left.groups.reduce((sum, group) => sum + group.weight, 0)).toBeCloseTo(1);
		expect(
			next.frame.bottom.groups.map(({ id, folded, tools }) => [
				id === bottom,
				folded,
				tools.map((tool) => tool.tool),
			]),
		).toEqual([
			[false, false, ["ext:board:activity"]],
			[true, true, []],
		]);
		expect(next.frame.bottom).toMatchObject({
			visible: true,
			height: 0.26,
			alignment: "center-left",
		});
		expect(next.viewsByWorkspace.A?.groups[bottom]?.tabs.map((tab) => tab.id)).toEqual(["term"]);
		expect(next.frame.right).toEqual(frame.right);
		expect(next.frame.toolRestoreTargets).toEqual(frame.toolRestoreTargets);
		const document = projectWorkspaceLayout(next.frame, next.viewsByWorkspace.A ?? view);
		expect(validateLayoutDocument(document, 32, 32)).toEqual([]);
	});

	test("restoring the captured sides and bottom with their targets gives the exact frame back", () => {
		const { frame, view } = balanced();
		const captured = captureWorkbenchSides(frame);
		const entered = arrangeWorkbenchView({ frame, viewsByWorkspace: { A: view } }, BOARD_VIEW);
		const left = restoreWorkbenchSides(entered, captured, frame.toolRestoreTargets);
		expect(left.frame).toEqual(frame);
		expect(left.viewsByWorkspace.A).toBe(view);
	});

	test("restores a frame whose side held a terminal pane without moving the terminal", () => {
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
		const state = { frame: terminalPane, viewsByWorkspace: { A: withTerminal } };
		const entered = arrangeWorkbenchView(state, BOARD_VIEW);
		expect(entered.viewsByWorkspace.A).toBe(withTerminal);
		expect(entered.frame.left.groups.find((group) => group.id === "left-terminals")?.folded).toBe(
			true,
		);
		const restored = restoreWorkbenchSides(
			entered,
			captureWorkbenchSides(terminalPane),
			terminalPane.toolRestoreTargets,
		);
		expect(restored.frame).toEqual(terminalPane);
		expect(restored.viewsByWorkspace.A?.groups[bottom]?.tabs.map((tab) => tab.id)).toEqual([
			"term",
		]);
	});

	test("takes a view's tool out of the group it sat in, dropping a tool group left empty", () => {
		const { frame } = balanced();
		const withNav = {
			...frame,
			right: {
				...frame.right,
				groups: [
					...frame.right.groups.map((group) => ({ ...group, weight: 0.4 })),
					{
						id: "right-nav",
						weight: 0.2,
						folded: false,
						tools: [
							{ kind: "tool" as const, id: "nav-tool", name: "", tool: "ext:board:nav" as const },
						],
					},
				],
			},
		};
		const next = arrangeWorkbenchView({ frame: withNav, viewsByWorkspace: {} }, BOARD_VIEW);
		expect(next.frame.right.groups.map((group) => group.id)).toEqual(
			frame.right.groups.map((group) => group.id),
		);
		expect(next.frame.right.groups.reduce((sum, group) => sum + group.weight, 0)).toBeCloseTo(1);
		expect(next.frame.left.groups[0]?.tools[0]?.id).toBe("nav-tool");
	});
});
