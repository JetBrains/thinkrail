import { describe, expect, test } from "bun:test";
import { currentTranslator } from "@thinkrail/locales/react";
import type { LayoutAttention } from "../../lib";
import { collectCenterGroups, findTabLocation, isLayoutUnavailable, toolTab } from "./model";
import { type TabAction, type TabActionContext, tabActions, tabActionTarget } from "./tabActions";
import type {
	LayoutCenterTab,
	LayoutTab,
	LayoutTerminalTab,
	WorkspaceLayoutDocument,
} from "./types";

const t = currentTranslator();

function file(id: string): LayoutCenterTab {
	return { kind: "file", id, name: id, path: `src/${id}` };
}

const terminal: LayoutTerminalTab = { kind: "terminal", id: "term", name: "zsh", tabKey: "t1" };

function documentWith(overrides: Partial<WorkspaceLayoutDocument> = {}): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: {
			kind: "split",
			id: "split",
			direction: "horizontal",
			weights: [0.5, 0.5],
			children: [
				{ kind: "group", id: "center-a", tabs: [file("a1"), file("a2")] },
				{ kind: "group", id: "center-b", tabs: [file("b1")] },
			],
		},
		left: {
			visible: true,
			width: 0.2,
			groups: [{ id: "left-a", weight: 1, folded: false, tabs: [toolTab("projects")] }],
		},
		right: { visible: false, width: 0.2, groups: [] },
		bottom: {
			visible: true,
			height: 0.3,
			alignment: "center",
			groups: [{ id: "bottom-a", weight: 1, folded: false, tabs: [terminal] }],
		},
		toolRestoreTargets: {},
		...overrides,
	};
}

function attention(selectedByGroup: Record<string, string>): LayoutAttention {
	return {
		selectedByGroup,
		lastFocusedCenterGroupId: "center-b",
		lastFocusedSideGroupId: {},
		navigationClockByGroup: {},
	};
}

const selected = attention({
	"center-a": "a2",
	"center-b": "b1",
	"left-a": toolTab("projects").id,
	"bottom-a": "term",
});

function actionsFor(
	document: WorkspaceLayoutDocument,
	tab: LayoutTab,
	overrides: Partial<TabActionContext> = {},
): TabAction[] {
	const location = findTabLocation(document, tab.id);
	if (!location) throw new Error(`${tab.id} is not placed`);
	return tabActions(t, {
		document,
		tab,
		location,
		preview: false,
		reorder: { previous: undefined, next: undefined },
		maxSideGroups: 6,
		maxBottomGroups: 3,
		canFocusAdjacentGroup: true,
		canRenameChat: false,
		worktreePath: "/repo",
		...overrides,
	});
}

function ids(actions: readonly TabAction[], surface: "menu" | "palette"): string[] {
	return actions
		.filter((action) => action.surface !== (surface === "menu" ? "palette" : "menu"))
		.map((action) => action.id);
}

function run(action: TabAction | undefined): WorkspaceLayoutDocument {
	if (action?.effect.kind !== "apply") throw new Error("not a layout action");
	const result = action.effect.result();
	if (isLayoutUnavailable(result)) throw new Error(result.reason);
	return result.document;
}

describe("tabActionTarget", () => {
	test("targets the selected tab of the given group", () => {
		expect(tabActionTarget(documentWith(), selected, "center-a")?.tab.id).toBe("a2");
		expect(tabActionTarget(documentWith(), selected, "bottom-a")?.tab.id).toBe("term");
		expect(tabActionTarget(documentWith(), selected, "left-a")?.tab.kind).toBe("tool");
	});

	test("falls back to the last focused center group, then to the group's first tab", () => {
		expect(tabActionTarget(documentWith(), selected, undefined)?.tab.id).toBe("b1");
		expect(tabActionTarget(documentWith(), attention({}), "center-a")?.tab.id).toBe("a1");
	});

	test("ignores hidden regions, folded and missing groups", () => {
		const hiddenRight = documentWith({
			right: {
				visible: false,
				width: 0.2,
				groups: [{ id: "right-a", weight: 1, folded: false, tabs: [terminal] }],
			},
		});
		expect(tabActionTarget(hiddenRight, attention({ "right-a": "term" }), "right-a")).toBeNull();
		const folded = documentWith({
			bottom: {
				visible: true,
				height: 0.3,
				alignment: "center",
				groups: [{ id: "bottom-a", weight: 1, folded: true, tabs: [terminal] }],
			},
		});
		expect(tabActionTarget(folded, selected, "bottom-a")).toBeNull();
		expect(tabActionTarget(documentWith(), selected, "missing")).toBeNull();
	});
});

describe("tabActions", () => {
	test("the menu and the palette list the same tab commands from one source", () => {
		const actions = actionsFor(documentWith(), file("a2"), {
			preview: true,
			reorder: { previous: 0, next: undefined },
			canRenameChat: true,
		});
		expect(ids(actions, "menu")).toContain("tab.focus");
		expect(ids(actions, "palette")).not.toContain("tab.focus");
		expect(ids(actions, "menu")).not.toContain("tab.moveToNextGroup");
		expect(ids(actions, "palette")).toContain("tab.moveToNextGroup");
		for (const id of ["tab.close", "tab.keepPreview", "group.splitRight", "tab.copyPath"]) {
			expect(ids(actions, "menu")).toContain(id);
			expect(ids(actions, "palette")).toContain(id);
		}
		expect(actions.find((action) => action.id === "tab.copyPath")?.effect).toEqual({
			kind: "copy",
			text: "/repo/src/a2",
		});
	});

	test("a singleton tool gets no center-only commands and is never closed as a tab", () => {
		const actions = actionsFor(documentWith(), toolTab("projects"));
		const all = actions.map((action) => action.id);
		expect(all).not.toContain("tab.close");
		expect(all).not.toContain("tab.keepPreview");
		expect(all).not.toContain("group.splitRight");
		expect(all).not.toContain("tab.copyPath");
		expect(ids(actions, "menu")).toContain("tab.removeTool");
		expect(ids(actions, "palette")).not.toContain("tab.removeTool");
		expect(all).toContain("group.hide");
	});

	test("splits carry the group-limit and measured-size reasons", () => {
		const narrow = actionsFor(documentWith(), file("a1"), {
			splitGeometry: { horizontal: false, vertical: true },
		});
		expect(narrow.find((action) => action.id === "group.splitRight")?.unavailable?.reason).toBe(
			"This group needs 640px of width to split.",
		);
		expect(narrow.find((action) => action.id === "group.splitDown")?.unavailable).toBeUndefined();

		const full = documentWith({
			center: {
				kind: "split",
				id: "s1",
				direction: "horizontal",
				weights: [0.5, 0.5],
				children: [
					{
						kind: "split",
						id: "s2",
						direction: "vertical",
						weights: [0.5, 0.5],
						children: [
							{ kind: "group", id: "c1", tabs: [file("a1")] },
							{ kind: "group", id: "c2", tabs: [] },
						],
					},
					{
						kind: "split",
						id: "s3",
						direction: "vertical",
						weights: [0.5, 0.5],
						children: [
							{ kind: "group", id: "c3", tabs: [] },
							{ kind: "group", id: "c4", tabs: [] },
						],
					},
				],
			},
		});
		expect(
			actionsFor(full, file("a1")).find((action) => action.id === "group.splitLeft")?.unavailable
				?.label,
		).toBe("Split left — Center groups are limited to 4.");
	});

	test("a center tab moves to the adjacent center group in visual order, and not past the edge", () => {
		const document = documentWith();
		const first = actionsFor(document, file("a2"));
		expect(first.some((action) => action.id === "tab.moveToPreviousGroup")).toBe(false);
		const moved = run(first.find((action) => action.id === "tab.moveToNextGroup"));
		expect(
			collectCenterGroups(moved.center).map((group) => group.tabs.map((tab) => tab.id)),
		).toEqual([["a1"], ["b1", "a2"]]);
		const last = actionsFor(document, file("b1"));
		expect(last.some((action) => action.id === "tab.moveToNextGroup")).toBe(false);
		expect(last.some((action) => action.id === "tab.moveToPreviousGroup")).toBe(true);
	});

	test("an auxiliary tab walks its own region only into panes that can take it, unfolding the destination", () => {
		const document = documentWith({
			right: {
				visible: true,
				width: 0.2,
				groups: [
					{ id: "right-a", weight: 0.3, folded: false, tabs: [toolTab("specs")] },
					{ id: "right-b", weight: 0.3, folded: false, tabs: [terminal] },
					{ id: "right-c", weight: 0.4, folded: true, tabs: [toolTab("files")] },
				],
			},
			bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
		});
		const actions = actionsFor(document, toolTab("specs"));
		const next = actions.find((action) => action.id === "tab.moveToNextGroup");
		expect(next?.effect.kind).toBe("apply");
		if (next?.effect.kind !== "apply") return;
		const result = next.effect.result();
		if (isLayoutUnavailable(result)) throw new Error(result.reason);
		const target = result.document.right.groups.find((group) => group.id === "right-c");
		expect(target?.tabs.map((tab) => tab.id)).toEqual(["tool:files", "tool:specs"]);
		expect(target?.folded).toBe(false);
		expect(result.focusTabId).toBe("tool:specs");
		expect(actions.some((action) => action.id === "tab.moveToPreviousGroup")).toBe(false);
	});

	test("moves name their pane and stay listed but unavailable where tools and terminals would mix", () => {
		const document = documentWith({
			right: {
				visible: true,
				width: 0.2,
				groups: [{ id: "right-a", weight: 1, folded: false, tabs: [toolTab("specs")] }],
			},
		});
		const move = actionsFor(document, terminal).find(
			(action) => action.id === "tab.moveTo.right-a",
		);
		expect(move?.label).toBe("Move to right pane (Specs)");
		expect(move?.unavailable?.reason).toBe("Tools and terminals use separate panes.");
	});

	test("new groups respect the region limits", () => {
		const actions = actionsFor(documentWith(), terminal, { maxBottomGroups: 1 });
		const here = actions.find((action) => action.id === "tab.newGroupAfter");
		expect(here?.label).toBe("New group right");
		expect(here?.unavailable?.reason).toBe("limited to 1");
		expect(
			actions.find((action) => action.id === "tab.newGroup.left.start")?.unavailable,
		).toBeUndefined();
	});

	test("rename is offered only on a chat tab where the shell injects renaming", () => {
		const chat: LayoutCenterTab = { kind: "chat", id: "chat", name: "", sessionId: "s1" };
		const document = documentWith({
			center: { kind: "group", id: "center-a", tabs: [chat] },
		});
		expect(actionsFor(document, chat).some((action) => action.id === "tab.renameChat")).toBe(false);
		expect(
			actionsFor(document, chat, { canRenameChat: true }).some(
				(action) => action.id === "tab.renameChat",
			),
		).toBe(true);
	});
});
