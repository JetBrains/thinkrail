import { beforeEach, describe, expect, test } from "bun:test";
import { EXTENSION_QUERY_PROTOCOL_VERSION, type Workspace } from "@thinkrail/contracts";
import type { PanelDeclaration } from "@thinkrail/extension-api/web";
import { currentTranslator } from "@thinkrail/locales/react";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { findExtensionPanel, type RegisteredPanel, webExtensionCommands } from "../extensions";
import { keybindingKeys, resolveKeybindings } from "../keybindings";
import { useAppStore } from "../store";
import { chatActionsOf, openExtensionPanelForChat, railFooterItems } from "./extensionEntryPoints";
import {
	currentOpenableExtensionPanels,
	openableExtensionPanels,
	openExtensionPanelHere,
	railCommandPanel,
} from "./extensionPanelHost";

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
