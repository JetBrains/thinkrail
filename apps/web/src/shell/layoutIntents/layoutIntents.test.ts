import { describe, expect, test } from "bun:test";
import type { LayoutAttention } from "../../lib";
import type { LayoutTerminalTab, WorkspaceLayoutDocument } from "../layout";
import { findTabLocation } from "../layout";
import { placeTerminalForIntent } from "./layoutIntents";

function document(): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: { kind: "group", id: "center", tabs: [] },
		left: { visible: false, width: 0.18, groups: [] },
		right: { visible: false, width: 0.28, groups: [] },
		bottom: {
			visible: false,
			height: 0.3,
			alignment: "center",
			groups: [
				{ id: "bottom-one", weight: 0.5, folded: false, tabs: [] },
				{ id: "bottom-two", weight: 0.5, folded: true, tabs: [] },
			],
		},
		toolRestoreTargets: {},
	};
}

const attention: LayoutAttention = {
	selectedByGroup: {},
	lastFocusedCenterGroupId: "center",
	lastFocusedSideGroupId: { bottom: "bottom-two" },
	navigationClockByGroup: { center: 0 },
};

const terminal: LayoutTerminalTab = {
	kind: "terminal",
	id: "terminal:new",
	name: "Terminal 1",
	tabKey: "new",
};

const limits = { maxSideGroups: 6, maxBottomGroups: 3 } as const;

describe("terminal intent routing", () => {
	test("global creation uses and reveals the last-focused surviving bottom group", () => {
		const result = placeTerminalForIntent(document(), attention, terminal, undefined, limits);
		if ("reason" in result) throw new Error(result.reason);
		expect(findTabLocation(result.document, terminal.id)).toEqual({
			area: "bottom",
			groupId: "bottom-two",
		});
		expect(result.document.bottom.visible).toBe(true);
		expect(result.document.bottom.groups[1]?.folded).toBe(false);
	});

	test("a reserved hidden default keeps its captured bottom geometry and does not request focus", () => {
		const result = placeTerminalForIntent(
			document(),
			attention,
			terminal,
			{ area: "bottom", groupId: "bottom-two" },
			limits,
			false,
		);
		if ("reason" in result) throw new Error(result.reason);
		expect(findTabLocation(result.document, terminal.id)).toEqual({
			area: "bottom",
			groupId: "bottom-two",
		});
		expect(result.document.bottom.visible).toBe(false);
		expect(result.document.bottom.groups[1]?.folded).toBe(true);
		expect(result.focusGroupId).toBeUndefined();
		expect(result.focusTabId).toBeUndefined();

		const withoutSlot = document();
		withoutSlot.bottom.groups = [];
		const created = placeTerminalForIntent(
			withoutSlot,
			attention,
			terminal,
			undefined,
			limits,
			false,
		);
		if ("reason" in created) throw new Error(created.reason);
		expect(created.document.bottom.visible).toBe(false);
		expect(created.document.bottom.groups).toHaveLength(1);
		expect(findTabLocation(created.document, terminal.id)?.area).toBe("bottom");
		expect(created.focusGroupId).toBeUndefined();
	});

	test("global creation makes a bottom slot while an explicit center target stays center", () => {
		const empty = document();
		empty.bottom.groups = [];
		const created = placeTerminalForIntent(empty, attention, terminal, undefined, limits);
		if ("reason" in created) throw new Error(created.reason);
		expect(findTabLocation(created.document, terminal.id)?.area).toBe("bottom");
		expect(created.document.bottom.groups).toHaveLength(1);

		const centered = placeTerminalForIntent(
			document(),
			attention,
			terminal,
			{ area: "center", groupId: "center" },
			limits,
		);
		if ("reason" in centered) throw new Error(centered.reason);
		expect(findTabLocation(centered.document, terminal.id)?.area).toBe("center");
	});
});
