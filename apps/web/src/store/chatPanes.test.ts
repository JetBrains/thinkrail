import { beforeEach, describe, expect, test } from "bun:test";
import type { Workspace } from "@thinkrail/contracts";
import { layoutResourceIdentity } from "../lib";
import type { WorkspaceLayoutDocument } from "../shell/layout";
import {
	type ChatPanePanel,
	chatPaneViewKey,
	type ExtensionTab,
	selectChatPane,
	selectChatPlacedInCenter,
	selectPanelViewState,
	useAppStore,
} from "./index";

const state = useAppStore.getState;
const analysis: ChatPanePanel = {
	extension: "insights",
	panel: "analysis",
	params: { sessionId: "s1" },
};
const notes: ChatPanePanel = { extension: "notes", panel: "outline", params: {} };

const workspace: Workspace = {
	id: "w1",
	projectId: "p1",
	name: "w1",
	branch: "main",
	baseBranch: "main",
	worktreePath: "/tmp/w1",
};

const extensionTab: ExtensionTab = {
	kind: "extension",
	id: "extension-tab",
	workspaceId: "w1",
	name: "Plan the trip",
	extension: "insights",
	panel: "analysis",
	titleKey: "common.retry",
	params: { sessionId: "s1" },
};

function centerLayout(sessionIds: readonly string[]): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: {
			kind: "group",
			id: "center",
			tabs: sessionIds.map((sessionId) => ({
				kind: "chat",
				id: `chat:${sessionId}`,
				name: "",
				sessionId,
			})),
		},
		left: { visible: false, width: 0.2, groups: [] },
		right: { visible: false, width: 0.2, groups: [] },
		bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
		toolRestoreTargets: {},
	};
}

beforeEach(() => {
	useAppStore.setState({
		activeWorkspaceId: "w1",
		selectedProjectId: "p1",
		workspaces: { p1: [workspace] },
		chatPanesByWorkspace: {},
		panelViewStatesByWorkspace: {},
		removedWorkspaceIds: {},
		deletedSessionsByWorkspace: {},
		tabsByWorkspace: {},
		activeTabByWorkspace: {},
		layoutIntents: [],
		layoutDocumentsByWorkspace: {},
	});
});

describe("chat panes", () => {
	test("each chat keeps its own pane: open, closed, and replaced by another panel", () => {
		state().openChatPane("w1", "s1", analysis);
		expect(selectChatPane(state(), "w1", "s1")).toEqual({ ...analysis, open: true, width: null });
		expect(selectChatPane(state(), "w1", "s2")).toBeNull();

		state().setChatPaneWidth("w1", "s1", 40);
		state().openChatPane("w1", "s2", analysis);
		state().closeChatPane("w1", "s1");
		expect(selectChatPane(state(), "w1", "s1")).toMatchObject({ open: false, width: 40 });
		expect(selectChatPane(state(), "w1", "s2")).toMatchObject({ open: true, width: null });

		state().openChatPane("w1", "s1", notes);
		expect(selectChatPane(state(), "w1", "s1")).toEqual({ ...notes, open: true, width: 40 });
	});

	test("an unchanged width or a closed pane closing again writes nothing", () => {
		state().openChatPane("w1", "s1", analysis);
		state().setChatPaneWidth("w1", "s1", 35);
		const before = state().chatPanesByWorkspace;
		state().setChatPaneWidth("w1", "s1", 35);
		state().closeChatPane("w1", "s9");
		state().setChatPaneWidth("w1", "s9", 50);
		expect(state().chatPanesByWorkspace).toBe(before);
	});

	test("a deleted chat and a removed workspace drop their panes and pane view states", () => {
		state().openChatPane("w1", "s1", analysis);
		state().openChatPane("w1", "s2", analysis);
		state().savePanelViewState("w1", chatPaneViewKey("s1", "insights", "analysis"), { a: 1 });
		state().savePanelViewState("w1", chatPaneViewKey("s2", "insights", "analysis"), { b: 2 });

		state().deleteChat("w1", "s1");
		expect(selectChatPane(state(), "w1", "s1")).toBeNull();
		expect(selectChatPane(state(), "w1", "s2")).not.toBeNull();
		expect(
			selectPanelViewState(state(), "w1", chatPaneViewKey("s1", "insights", "analysis")),
		).toBeUndefined();
		expect(
			selectPanelViewState(state(), "w1", chatPaneViewKey("s2", "insights", "analysis")),
		).toEqual({ b: 2 });

		state().applyWorkspaceRemoved("p1", "w1");
		expect(state().chatPanesByWorkspace.w1).toBeUndefined();
		expect(state().panelViewStatesByWorkspace.w1).toBeUndefined();
	});

	test("a chat is beside-able only while it has a tab in the active workspace's center", () => {
		useAppStore.setState({ layoutDocumentsByWorkspace: { w1: centerLayout(["s1"]) } });
		expect(selectChatPlacedInCenter(state(), "w1", "s1")).toBe(true);
		expect(selectChatPlacedInCenter(state(), "w1", "s2")).toBe(false);
		useAppStore.setState({ activeWorkspaceId: "w2" });
		expect(selectChatPlacedInCenter(state(), "w1", "s1")).toBe(false);
		useAppStore.setState({ activeWorkspaceId: null });
		expect(selectChatPlacedInCenter(state(), "w1", "s1")).toBe(false);
	});
});

describe("panel view state", () => {
	test("keeps the last value saved per key, and forgets one saved as undefined", () => {
		state().savePanelViewState("w1", "k", { section: "trace" });
		state().savePanelViewState("w1", "k", { section: "errors" });
		expect(selectPanelViewState(state(), "w1", "k")).toEqual({ section: "errors" });
		state().savePanelViewState("w1", "k", undefined);
		expect(state().panelViewStatesByWorkspace.w1).toEqual({});
		const before = state().panelViewStatesByWorkspace;
		state().savePanelViewState("w1", "k", undefined);
		expect(state().panelViewStatesByWorkspace).toBe(before);
	});

	test("closing an extension tab drops its view state; other tabs keep theirs", () => {
		const key = layoutResourceIdentity(extensionTab);
		useAppStore.setState({ tabsByWorkspace: { w1: [extensionTab] } });
		state().savePanelViewState("w1", key, { section: "files" });
		state().savePanelViewState("w1", "other", { kept: true });

		state().closeTab(extensionTab.id, false, false, "w1");

		expect(selectPanelViewState(state(), "w1", key)).toBeUndefined();
		expect(selectPanelViewState(state(), "w1", "other")).toEqual({ kept: true });
	});
});
