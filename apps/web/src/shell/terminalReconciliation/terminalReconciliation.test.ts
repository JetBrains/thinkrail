import { describe, expect, test } from "bun:test";
import type { LayoutTerminalTab, WorkspaceLayoutDocument } from "@thinkrail/contracts";
import type { LayoutAttention } from "../../lib";
import { findTabLocation, toolTab } from "../layout";
import { placeRecoveredTerminal } from "./terminalReconciliation";

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
				{ id: "bottom-two", weight: 0.5, folded: false, tabs: [toolTab("changes")] },
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
	id: "terminal:recovered",
	name: "Recovered",
	tabKey: "recovered",
};

describe("recovered terminal placement", () => {
	test("uses the last-focused surviving bottom group without revealing the region", () => {
		const result = placeRecoveredTerminal(document(), attention, terminal);
		expect(findTabLocation(result.document, terminal.id)).toEqual({
			area: "bottom",
			groupId: "bottom-two",
		});
		expect(result.document.bottom.visible).toBe(false);
	});

	test("uses an existing center group without reshaping when bottom has no group", () => {
		const empty = document();
		empty.bottom.groups = [];
		const result = placeRecoveredTerminal(empty, attention, terminal);
		expect(findTabLocation(result.document, terminal.id)).toEqual({
			area: "center",
			groupId: "center",
		});
		expect(result.document.bottom.groups).toHaveLength(0);
	});
});
