import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { EXTENSION_QUERY_PROTOCOL_VERSION, type Workspace } from "@thinkrail/contracts";
import type { PanelDeclaration } from "@thinkrail/extension-api/web";
import { currentTranslator } from "@thinkrail/locales/react";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { findExtensionPanel, type RegisteredPanel, webExtensionCommands } from "../extensions";
import { keybindingKeys, resolveKeybindings } from "../keybindings";
import { layoutResourceIdentity } from "../lib";
import {
	chatPaneViewKey,
	type LayoutIntent,
	selectChatPane,
	selectPanelViewState,
	useAppStore,
} from "../store";
import * as chordActions from "./chordActions";
import {
	chatActionsOf,
	moveChatPaneToTab,
	openExtensionPanelForChat,
	railFooterItems,
} from "./extensionEntryPoints";
import {
	currentOpenableExtensionPanels,
	openableExtensionPanels,
	openExtensionPanelHere,
	railCommandPanel,
} from "./extensionPanelHost";
import type { WorkspaceLayoutDocument } from "./layout";

const t = currentTranslator();
const load = async () => ({ default: () => null });
const declaration = (overrides: Partial<PanelDeclaration>): PanelDeclaration => ({
	title: "common.retry",
	icon: () => null,
	scopes: ["project"],
	load,
	...overrides,
});
const list: RegisteredPanel = {
	extension: "insights",
	panel: "list",
	declaration: declaration({ rail: { command: "insights.open" } }),
};
const analysis: RegisteredPanel = {
	extension: "insights",
	panel: "analysis",
	declaration: declaration({
		title: "sessionInsights.session.title",
		scopes: ["session"],
		chatAction: {
			menuLabel: "sessionInsights.session.analyze",
			params: ({ sessionId, projectId }) => ({ sessionId, projectId }),
		},
	}),
};
const plain: RegisteredPanel = { extension: "other", panel: "plain", declaration: declaration({}) };
const PANELS = [list, analysis, plain];

const openable = (input: Partial<Parameters<typeof openableExtensionPanels>[0]> = {}) =>
	openableExtensionPanels({
		disabled: [],
		protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION,
		catalog: "loading",
		panels: PANELS,
		...input,
	});

const workspace = (id: string, projectId: string, kind?: Workspace["kind"]): Workspace => ({
	id,
	projectId,
	name: id,
	branch: "main",
	baseBranch: "main",
	worktreePath: `/tmp/${id}`,
	...(kind ? { kind } : {}),
});

describe("chat actions", () => {
	test("every chat surface offers the openable panels that declare one, worded by the panel", () => {
		expect(
			chatActionsOf(t, openable()).map(({ id, label, menuLabel }) => [id, label, menuLabel]),
		).toEqual([["insights.analysis", "Session analysis", "Analyze session"]]);
		const withLabel: RegisteredPanel = {
			...analysis,
			declaration: {
				...analysis.declaration,
				chatAction: { menuLabel: "common.retry", params: () => ({}), label: "common.close" },
			},
		};
		expect(chatActionsOf(t, [withLabel])[0]?.label).toBe("Close");
	});

	test("none while the extension is off, the host too old to answer or missing from its catalog", () => {
		expect(chatActionsOf(t, openable({ disabled: ["insights"] }))).toEqual([]);
		expect(
			chatActionsOf(t, openable({ protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION - 1 })),
		).toEqual([]);
		expect(chatActionsOf(t, openable({ protocolVersion: null }))).toEqual([]);
		const listed = { name: "other", title: "Other", enabled: true, tools: [] };
		expect(
			chatActionsOf(t, openable({ catalog: [{ ...listed, hasChildExtensions: false }] })),
		).toEqual([]);
	});

	beforeEach(() => {
		useAppStore.setState({
			activeWorkspaceId: "w1",
			selectedProjectId: "p1",
			projects: [],
			workspaces: { p1: [workspace("w1", "p1")], chats: [workspace("c1", "chats", "chat")] },
			tabsByWorkspace: {},
			activeTabByWorkspace: {},
			layoutIntents: [],
			removedWorkspaceIds: {},
			sessions: {},
			closedChatsByWorkspace: {},
			sessionStateByWorkspace: {
				c1: {
					s1: {
						sessionId: "s1",
						workspaceId: "c1",
						projectId: "chats",
						title: "Plan the trip",
						state: {
							execution: "idle",
							runId: null,
							needsInput: null,
							completion: null,
							completionUnread: false,
							queuedCount: 0,
							backgroundWork: false,
						},
					},
				},
			},
		});
	});

	test("opens that chat's panel in the active workspace, with the chat's params and named after it", () => {
		const [action] = chatActionsOf(t, openable());
		action?.run({ workspaceId: "c1", sessionId: "s1" });
		const state = useAppStore.getState();
		expect(state.activeWorkspaceId).toBe("w1");
		expect(state.tabsByWorkspace.w1).toEqual([
			expect.objectContaining({
				kind: "extension",
				extension: "insights",
				panel: "analysis",
				name: "Plan the trip",
				params: { sessionId: "s1", projectId: "chats" },
			}),
		]);
	});

	test("on Project Home it enters the chat's workspace and opens the panel there", () => {
		useAppStore.setState({ activeWorkspaceId: null });
		openExtensionPanelForChat(analysis, { workspaceId: "c1", sessionId: "s1" });
		const state = useAppStore.getState();
		expect(state.activeWorkspaceId).toBe("c1");
		expect(state.tabsByWorkspace.c1?.map((tab) => tab.kind)).toEqual(["extension"]);
		openExtensionPanelForChat(list, { workspaceId: "c1", sessionId: "s1" });
		openExtensionPanelForChat(analysis, { workspaceId: "gone", sessionId: "s1" });
		expect(useAppStore.getState().tabsByWorkspace.c1).toHaveLength(1);
	});
});

describe("a chat panel beside its chat", () => {
	const beside: RegisteredPanel = {
		extension: "insights",
		panel: "beside",
		declaration: declaration({
			title: "sessionInsights.session.title",
			scopes: ["session"],
			chatPane: true,
			wide: true,
			chatAction: {
				menuLabel: "sessionInsights.session.analyze",
				params: ({ sessionId }) => ({ sessionId }),
			},
		}),
	};
	const narrow: RegisteredPanel = {
		extension: "notes",
		panel: "outline",
		declaration: declaration({
			scopes: ["session"],
			chatPane: true,
			chatAction: { menuLabel: "common.retry", params: ({ sessionId }) => ({ sessionId }) },
		}),
	};
	const chatTab = (sessionId: string) => ({
		kind: "chat" as const,
		id: `chat:${sessionId}`,
		workspaceId: "w1",
		name: "",
		sessionId,
	});
	const layout = (sessionIds: readonly string[]): WorkspaceLayoutDocument => ({
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
	});
	const attend = (sessionId: string) => ({
		selectedByGroup: { center: `chat:${sessionId}` },
		lastFocusedCenterGroupId: "center",
		lastFocusedSideGroupId: {},
		navigationClockByGroup: { center: 0 },
	});
	const opened = (intents: readonly LayoutIntent[]) =>
		intents.flatMap((intent) => (intent.kind === "open" ? [intent.tab.kind] : []));
	let hide: ReturnType<typeof spyOn<typeof chordActions, "hideAllPanels">>;

	beforeEach(() => {
		hide = spyOn(chordActions, "hideAllPanels").mockImplementation(() => {});
		useAppStore.setState({
			activeWorkspaceId: "w1",
			selectedProjectId: "p1",
			projects: [],
			workspaces: { p1: [workspace("w1", "p1")], chats: [workspace("c1", "chats", "chat")] },
			tabsByWorkspace: { w1: [chatTab("s1"), chatTab("s2")] },
			activeTabByWorkspace: {},
			layoutIntents: [],
			removedWorkspaceIds: {},
			deletedSessionsByWorkspace: {},
			obscuredChatSessions: {},
			historyOpenRequest: null,
			layoutDocumentsByWorkspace: { w1: layout(["s1", "s2"]) },
			layoutAttentionByWorkspace: { w1: attend("s1") },
			chatPanesByWorkspace: {},
			panelViewStatesByWorkspace: {},
			sessions: {},
			closedChatsByWorkspace: {},
			sessionStateByWorkspace: {},
		});
	});

	afterEach(() => hide.mockRestore());

	test("every chat surface marks the panel as one that opens beside its chat", () => {
		const actions = chatActionsOf(t, [beside, analysis]);
		expect(actions.map(({ id, pane }) => [id, pane])).toEqual([
			["insights.beside", true],
			["insights.analysis", undefined],
		]);
	});

	test("the chat in view gets the pane in place: no tab, no tab switch, the side panes hidden once", () => {
		openExtensionPanelForChat(beside, { workspaceId: "w1", sessionId: "s1" });
		openExtensionPanelForChat(beside, { workspaceId: "w1", sessionId: "s1" });

		const state = useAppStore.getState();
		expect(selectChatPane(state, "w1", "s1")).toEqual({
			extension: "insights",
			panel: "beside",
			params: { sessionId: "s1" },
			open: true,
			width: null,
		});
		expect(state.tabsByWorkspace.w1?.some((tab) => tab.kind === "extension")).toBe(false);
		expect(state.layoutIntents).toEqual([]);
		expect(hide.mock.calls).toEqual([["w1"]]);
	});

	test("a chat open in another tab of the center is brought forward with its pane", () => {
		openExtensionPanelForChat(narrow, { workspaceId: "w1", sessionId: "s2" });

		const state = useAppStore.getState();
		expect(selectChatPane(state, "w1", "s2")?.open).toBe(true);
		expect(opened(state.layoutIntents)).toEqual(["chat"]);
		expect(hide).not.toHaveBeenCalled();
	});

	test("another panel for the same chat replaces the pane, keeping its width", () => {
		openExtensionPanelForChat(narrow, { workspaceId: "w1", sessionId: "s1" });
		useAppStore.getState().setChatPaneWidth("w1", "s1", 38);
		openExtensionPanelForChat(beside, { workspaceId: "w1", sessionId: "s1" });

		expect(selectChatPane(useAppStore.getState(), "w1", "s1")).toMatchObject({
			extension: "insights",
			panel: "beside",
			width: 38,
		});
		expect(hide).toHaveBeenCalledTimes(1);
	});

	test("a chat not open in this workspace's center gets the tab, as does a panel without a pane", () => {
		const extensionTabs = () =>
			(useAppStore.getState().tabsByWorkspace.w1 ?? []).filter((tab) => tab.kind === "extension");
		openExtensionPanelForChat(beside, { workspaceId: "w1", sessionId: "closed" });
		openExtensionPanelForChat(beside, { workspaceId: "c1", sessionId: "s9" });
		openExtensionPanelForChat(analysis, { workspaceId: "w1", sessionId: "s1" });

		expect(useAppStore.getState().chatPanesByWorkspace).toEqual({});
		expect(extensionTabs().map((tab) => tab.kind === "extension" && tab.params)).toEqual([
			{ sessionId: "closed" },
			{ sessionId: "s9" },
			{ sessionId: "s1", projectId: "p1" },
		]);
		expect(hide.mock.calls).toEqual([["w1"], ["w1"]]);
	});

	test("on Project Home it opens the tab in the chat's workspace", () => {
		useAppStore.setState({ activeWorkspaceId: null });
		openExtensionPanelForChat(beside, { workspaceId: "w1", sessionId: "s1" });

		const state = useAppStore.getState();
		expect(state.activeWorkspaceId).toBe("w1");
		expect(state.chatPanesByWorkspace).toEqual({});
		expect(state.tabsByWorkspace.w1?.filter((tab) => tab.kind === "extension")).toHaveLength(1);
	});

	test("Open as tab moves the pane to the chat's tab with its view state and closes the pane", () => {
		useAppStore.setState({
			sessionStateByWorkspace: {
				w1: {
					s1: {
						sessionId: "s1",
						workspaceId: "w1",
						projectId: "p1",
						title: "Fix the login flow",
						state: {
							execution: "idle",
							runId: null,
							needsInput: null,
							completion: null,
							completionUnread: false,
							queuedCount: 0,
							backgroundWork: false,
						},
					},
				},
			},
		});
		openExtensionPanelForChat(beside, { workspaceId: "w1", sessionId: "s1" });
		useAppStore
			.getState()
			.savePanelViewState("w1", chatPaneViewKey("s1", "insights", "beside"), { section: "errors" });

		moveChatPaneToTab(beside, { workspaceId: "w1", sessionId: "s1" });

		const state = useAppStore.getState();
		expect(selectChatPane(state, "w1", "s1")?.open).toBe(false);
		const tab = state.tabsByWorkspace.w1?.find((candidate) => candidate.kind === "extension");
		expect(tab).toMatchObject({
			name: "Fix the login flow",
			extension: "insights",
			panel: "beside",
			params: { sessionId: "s1" },
		});
		if (tab?.kind !== "extension") throw new Error("expected the panel's tab");
		expect(selectPanelViewState(state, "w1", layoutResourceIdentity(tab))).toEqual({
			section: "errors",
		});
	});
});

describe("the rail", () => {
	test("an icon for each openable panel with a rail, wherever it can open, above the keyboard icon", () => {
		const keys = (panels: readonly RegisteredPanel[], placeable = true) =>
			railFooterItems(panels, placeable).map(({ key }) => key);
		expect(keys(openable())).toEqual(["extension:insights.list", "shortcuts"]);
		expect(keys(openable(), false)).toEqual(["shortcuts"]);
		expect(keys(openable({ disabled: ["insights"] }))).toEqual(["shortcuts"]);
		expect(keys(openable({ protocolVersion: null }))).toEqual(["shortcuts"]);
	});

	test("Session insights' icon is named and labelled like the panel, with the chord in its tooltip", () => {
		const sessions = findExtensionPanel("session-insights", "sessions");
		if (!sessions) throw new Error("session insights declares no session list");
		const [item] = railFooterItems([sessions], true);
		const html = renderToStaticMarkup(
			<TooltipProvider>{item?.render({ tabIndex: 0, onFocus: () => {} })}</TooltipProvider>,
		);
		expect(html).toContain('data-testid="extension-rail-session-insights-sessions"');
		expect(html).toContain('aria-label="Session insights"');
		const extensions = webExtensionCommands([]);
		const chord = (platform: string, overrides = {}) =>
			keybindingKeys(
				resolveKeybindings({ platform, extensions, overrides }),
				"session-insights.openSessions",
			);
		expect(chord("Win32")).toEqual(["Ctrl", "Alt", "I"]);
		expect(chord("MacIntel")).toEqual(["⌃", "⌥", "I"]);
		expect(chord("Linux x86_64", { "session-insights.openSessions": ["Mod+Shift+KeyU"] })).toEqual([
			"Ctrl",
			"Shift",
			"U",
		]);
	});

	test("its chord opens the shipped panel only while an entry point may offer it", () => {
		useAppStore.setState({
			protocolVersion: EXTENSION_QUERY_PROTOCOL_VERSION,
			disabledExtensions: [],
			connectionGeneration: 0,
		});
		const sessions = railCommandPanel("session-insights", "session-insights.openSessions");
		if (!sessions) throw new Error("no session list behind the rail command");
		expect(sessions.panel).toBe("sessions");
		expect(currentOpenableExtensionPanels()).toContain(sessions);
		expect(railCommandPanel("session-insights", "session-insights.search")).toBeUndefined();
		expect(railCommandPanel("hint-mode", "session-insights.openSessions")).toBeUndefined();
		useAppStore.setState({ disabledExtensions: ["session-insights"] });
		expect(railCommandPanel("session-insights", "session-insights.openSessions")).toBeNull();
		useAppStore.setState({ disabledExtensions: [], protocolVersion: null });
		expect(railCommandPanel("session-insights", "session-insights.openSessions")).toBeNull();
	});

	test("opens where the user is: the active workspace, and nowhere without a workspace or project", () => {
		useAppStore.setState({
			activeWorkspaceId: "w1",
			tabsByWorkspace: {},
			layoutIntents: [],
			removedWorkspaceIds: {},
		});
		openExtensionPanelHere(list);
		expect(useAppStore.getState().tabsByWorkspace.w1?.map((tab) => tab.kind)).toEqual([
			"extension",
		]);
		useAppStore.setState({
			activeWorkspaceId: null,
			selectedProjectId: null,
			projects: [],
			tabsByWorkspace: {},
		});
		openExtensionPanelHere(list);
		expect(useAppStore.getState().tabsByWorkspace).toEqual({});
	});
});
