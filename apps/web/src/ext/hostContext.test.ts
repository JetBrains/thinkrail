import { expect, test } from "bun:test";
import { selectHostIds } from "./hostContext";

type HostIdsState = Parameters<typeof selectHostIds>[0];
type Layout = HostIdsState["layoutDocumentsByWorkspace"][string];

const layout = (selected: "chat" | "ext"): Layout => ({
	version: 2,
	center: {
		kind: "group",
		id: "center",
		tabs:
			selected === "chat"
				? [{ kind: "chat", id: "w:s2", name: "Two", sessionId: "s2" }]
				: [{ kind: "extension", id: "ext-tab", name: "Demo", extension: "demo", surface: "big" }],
	},
	left: { visible: false, width: 0.2, groups: [] },
	right: { visible: false, width: 0.2, groups: [] },
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
});

const state = (selected: "chat" | "ext"): HostIdsState => ({
	activeWorkspaceId: "w",
	workspaces: {
		p: [
			{ id: "w", projectId: "p", name: "W", branch: "w", worktreePath: "/w", baseBranch: "main" },
		],
	},
	layoutDocumentsByWorkspace: { w: layout(selected) },
	layoutAttentionByWorkspace: {
		w: {
			selectedByGroup: {},
			lastFocusedCenterGroupId: "center",
			lastFocusedSideGroupId: {},
			navigationClockByGroup: { center: 0 },
		},
	},
	tabsByWorkspace: {
		w: [
			{ kind: "chat", id: "w:s1", workspaceId: "w", name: "One", sessionId: "s1" },
			{ kind: "chat", id: "w:s2", workspaceId: "w", name: "Two", sessionId: "s2" },
		],
	},
	activeTabByWorkspace: { w: null },
});

test("selectHostIds reads the focused chat tab", () => {
	expect(selectHostIds(state("chat"))).toEqual({
		projectId: "p",
		workspaceId: "w",
		sessionId: "s2",
	});
});

test("selectHostIds falls back to the newest chat while an extension tab has focus", () => {
	expect(selectHostIds(state("ext")).sessionId).toBe("s2");
});
