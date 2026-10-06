import { describe, expect, test } from "bun:test";
import type { LayoutAttention } from "../../lib";
import { closeRequestTarget } from "./closeRequest";
import { toolTab } from "./model";
import type { LayoutCenterTab, LayoutTerminalTab, WorkspaceLayoutDocument } from "./types";

function file(id: string): LayoutCenterTab {
	return { kind: "file", id, name: id, path: id };
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

describe("closeRequestTarget", () => {
	test("closes the selected tab of the focused group", () => {
		expect(closeRequestTarget(documentWith(), selected, "center-a")?.id).toBe("a2");
		expect(closeRequestTarget(documentWith(), selected, "bottom-a")?.id).toBe("term");
	});

	test("falls back to the last focused center group", () => {
		expect(closeRequestTarget(documentWith(), selected, undefined)?.id).toBe("b1");
	});

	test("never closes a singleton tool", () => {
		expect(closeRequestTarget(documentWith(), selected, "left-a")).toBeNull();
	});

	test("falls back to the first tab when the group has no stored selection", () => {
		expect(closeRequestTarget(documentWith(), attention({}), "center-a")?.id).toBe("a1");
	});

	test("ignores groups in a hidden side region", () => {
		const hiddenRight = documentWith({
			right: {
				visible: false,
				width: 0.2,
				groups: [{ id: "right-a", weight: 1, folded: false, tabs: [terminal] }],
			},
		});
		expect(closeRequestTarget(hiddenRight, attention({ "right-a": "term" }), "right-a")).toBeNull();
	});

	test("ignores folded and missing groups", () => {
		const folded = documentWith({
			bottom: {
				visible: true,
				height: 0.3,
				alignment: "center",
				groups: [{ id: "bottom-a", weight: 1, folded: true, tabs: [terminal] }],
			},
		});
		expect(closeRequestTarget(folded, selected, "bottom-a")).toBeNull();
		expect(closeRequestTarget(documentWith(), selected, "missing")).toBeNull();
	});
});
