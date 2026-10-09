import { expect, test } from "bun:test";
import {
	activateAuxiliaryRailEntry,
	clusterAuxiliaryRail,
	isUnplacedRailEntry,
	projectAuxiliaryRail,
	projectWorkbenchRatio,
	resizeVisibleAuxiliaryGroups,
	restoreWorkbenchRatio,
	visibleAuxiliaryGroups,
} from "./auxiliaryPresentation";
import { closeLayoutTab, reconcileAttention, selectTab, toolTab } from "./model";
import type { LayoutTerminalTab, WorkspaceLayoutDocument } from "./types";

const terminal = (id: string): LayoutTerminalTab => ({
	kind: "terminal",
	id,
	tabKey: id,
	name: id,
});
function document(): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: { kind: "group", id: "center", tabs: [terminal("center-terminal")] },
		left: {
			visible: true,
			width: 0.2,
			groups: [{ id: "left", weight: 1, folded: false, tabs: [toolTab("projects")] }],
		},
		right: {
			visible: true,
			width: 0.25,
			groups: [
				{
					id: "tools",
					weight: 0.3,
					folded: false,
					tabs: [{ ...toolTab("files"), id: "custom-files" }, toolTab("changes")],
				},
				{ id: "shells", weight: 0.4, folded: false, tabs: [terminal("build"), terminal("tests")] },
				{ id: "other", weight: 0.3, folded: false, tabs: [terminal("server")] },
			],
		},
		bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
		toolRestoreTargets: {},
	};
}

function mutation<T extends { document: WorkspaceLayoutDocument } | { reason: string }>(value: T) {
	if ("reason" in value) throw new Error(value.reason);
	return value;
}

test("visible-pane resizing preserves folded weights and original group identities", () => {
	const doc = document();
	doc.right.groups = [
		{ id: "hidden", weight: 0.2, folded: true, tabs: [] },
		{ id: "one", weight: 0.4, folded: false, tabs: [] },
		{ id: "two", weight: 0.4, folded: false, tabs: [] },
	];
	expect(
		visibleAuxiliaryGroups(doc, "right").map(({ group, documentIndex, size }) => [
			group.id,
			documentIndex,
			size,
		]),
	).toEqual([
		["one", 1, 50],
		["two", 2, 50],
	]);
	const resized = resizeVisibleAuxiliaryGroups(doc, "right", [25, 75]);
	expect(resized.right.groups.map((group) => group.id)).toEqual(["hidden", "one", "two"]);
	expect(resized.right.groups[1]?.weight).toBeCloseTo(0.2);
	expect(resized.right.groups[2]?.weight).toBeCloseTo(0.6);
	expect(resized.right.groups[0]).toBe(doc.right.groups[0]);
	expect(resized.right.width).toBe(doc.right.width);
});

test("rail extents do not reinterpret saved workbench-wide dimensions", () => {
	expect(projectWorkbenchRatio(0.25, 1000, 920)).toBeCloseTo(250 / 920);
	expect(restoreWorkbenchRatio(250 / 920, 1000, 920)).toBeCloseTo(0.25);
	expect(projectWorkbenchRatio(0.3, 800, 768)).toBeCloseTo(240 / 768);
	expect(restoreWorkbenchRatio(240 / 768, 800, 768)).toBeCloseTo(0.3);
});

test("rail entries keep each pane's terminals together and tools in their own pane", () => {
	const doc = document();
	const entries = projectAuxiliaryRail(doc, reconcileAttention(doc), "right");
	const terminals = entries.filter((entry) => entry.kind === "terminals");
	expect(terminals.map((entry) => entry.groupId)).toEqual(["shells", "other"]);
	expect(terminals[0]?.tabs.map((tab) => tab.id)).toEqual(["build", "tests"]);
	expect(entries.find((entry) => entry.kind === "tool" && entry.tool === "files")).toMatchObject({
		tab: { id: "custom-files" },
		groupId: "tools",
	});
	expect(terminals.flatMap((entry) => entry.tabs).some((tab) => tab.id === "center-terminal")).toBe(
		false,
	);
});

test("rail clusters mirror the panes in order and park unplaced tools in a trailing cluster", () => {
	const doc = document();
	const attention = reconcileAttention(doc);
	expect(
		clusterAuxiliaryRail(projectAuxiliaryRail(doc, attention, "right")).map((cluster) => [
			cluster.groupId,
			cluster.entries.map((entry) => (entry.kind === "tool" ? entry.tool : entry.kind)),
		]),
	).toEqual([
		["tools", ["files", "changes"]],
		["shells", ["terminals"]],
		["other", ["terminals"]],
		[null, ["specs", "review"]],
	]);
	const closed = closeLayoutTab(doc, "custom-files").document;
	closed.toolRestoreTargets.files = { region: "right", index: 0 };
	const clusters = clusterAuxiliaryRail(projectAuxiliaryRail(closed, attention, "right"));
	expect(clusters.map((cluster) => cluster.groupId)).toEqual(["tools", "shells", "other", null]);
	const unplaced = clusters.at(-1)?.entries ?? [];
	expect(unplaced.map((entry) => (entry.kind === "tool" ? entry.tool : entry.kind)).sort()).toEqual(
		["files", "review", "specs"],
	);
	expect(unplaced.every(isUnplacedRailEntry)).toBe(true);
	expect(
		clusters
			.slice(0, -1)
			.flatMap((cluster) => cluster.entries)
			.some(isUnplacedRailEntry),
	).toBe(false);
});

test("a terminal entry restores the pane's selected session, else its first", () => {
	const doc = document();
	const location = { area: "right", groupId: "shells" } as const;
	const attention = reconcileAttention(doc, selectTab(reconcileAttention(doc), location, "tests"));
	const entry = projectAuxiliaryRail(doc, attention, "right").find(
		(entry) => entry.kind === "terminals" && entry.groupId === "shells",
	);
	if (!entry) throw new Error("Missing terminal group");
	expect(entry.kind === "terminals" ? entry.selectedTerminalId : null).toBe("tests");
	const folded = mutation(activateAuxiliaryRailEntry(doc, attention, entry, 6, 3));
	const restored = mutation(activateAuxiliaryRailEntry(folded.document, attention, entry, 6, 3));
	expect(restored.focusTabId).toBe("tests");
});

test("an active rail entry hides only its own pane without deleting resources", () => {
	const doc = document();
	const attention = reconcileAttention(doc);
	const entry = projectAuxiliaryRail(doc, attention, "right").find(
		(entry) => entry.kind === "terminals" && entry.groupId === "shells",
	);
	if (!entry) throw new Error("Missing terminal group");
	const hidden = mutation(activateAuxiliaryRailEntry(doc, attention, entry, 6, 3));
	expect(hidden.document.right.groups.map((group) => group.folded)).toEqual([false, true, false]);
	expect(hidden.document.right.visible).toBe(true);
	expect(hidden.document.right.groups[1]?.tabs).toEqual(doc.right.groups[1]?.tabs);
	const restored = mutation(activateAuxiliaryRailEntry(hidden.document, attention, entry, 6, 3));
	expect(restored.document.right.groups[1]?.folded).toBe(false);
	expect(restored.focusTabId).toBe("build");
});

test("restorable singleton entries honor bottom targets and noncanonical placement ids", () => {
	const doc = document();
	const closed = closeLayoutTab(doc, "custom-files").document;
	closed.toolRestoreTargets.files = { region: "bottom", index: 0 };
	const attention = reconcileAttention(closed);
	expect(
		projectAuxiliaryRail(closed, attention, "right").some(
			(entry) => entry.kind === "tool" && entry.tool === "files",
		),
	).toBe(false);
	const entry = projectAuxiliaryRail(closed, attention, "bottom").find(
		(entry) => entry.kind === "tool" && entry.tool === "files",
	);
	if (!entry) throw new Error("Missing restored tool entry");
	const result = mutation(activateAuxiliaryRailEntry(closed, attention, entry, 6, 3));
	expect(result.document.bottom.visible).toBe(true);
	expect(
		result.document.bottom.groups
			.flatMap((group) => group.tabs)
			.filter((tab) => tab.kind === "tool" && tab.tool === "files"),
	).toHaveLength(1);
});

test("an empty bottom entry reveals only a process-free creation surface", () => {
	const doc = document();
	const attention = reconcileAttention(doc);
	const entry = projectAuxiliaryRail(doc, attention, "bottom").find(
		(entry) => entry.kind === "empty",
	);
	if (!entry) throw new Error("Missing empty bottom entry");
	const result = mutation(activateAuxiliaryRailEntry(doc, attention, entry, 6, 3));
	expect(result.document.bottom.visible).toBe(true);
	expect(result.document.bottom.groups).toHaveLength(1);
	expect(result.document.bottom.groups[0]?.tabs).toEqual([]);
	expect(result.document.center).toBe(doc.center);
});
