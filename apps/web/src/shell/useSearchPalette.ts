import { useT } from "@thinkrail/locales/react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { copyText } from "../lib";
import { enterDefaultWorkspace } from "../panels/defaultWorkspace";
import { startChatInTab } from "../panels/openChat";
import { settingsNavGroups } from "../panels/settingsNav";
import {
	canSettleWorkspace,
	goToProjectHome,
	markWorkspaceRead,
	markWorkspaceUnread,
	openWorkspaceIn,
	revealWorkspace,
	settleWorkspace,
	unsettleWorkspace,
	useEditors,
} from "../panels/workspaceActions";
import {
	buildWorkItems,
	commandItems,
	type PaletteItem,
	type SearchPaletteProps,
	type SearchScope,
	waitingItems,
} from "../search";
import {
	type SettingsSection,
	selectActiveWorkspace,
	selectContextProject,
	selectHistoryTarget,
	selectRecordFirstPrompts,
	selectSupportsOnboarding,
	selectSwitcherGroups,
	selectWorkspaceReadAction,
	selectWorkspaceSettleBlocked,
	selectWorkspaceSettledReason,
	supportsWorkspaceReadState,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import {
	openChatHistory,
	toggleBottomPanel,
	toggleLeftSide,
	toggleRightSide,
} from "./chordActions";
import { createPaletteBackfill, mergeProjectWorkspaces } from "./paletteBackfill";
import {
	buildCommands,
	buildSettingsItems,
	emptyStateActionIds,
	type PaletteCatalogDeps,
} from "./paletteCatalog";
import { createPaletteNavigator } from "./paletteNavigation";
import { readSettingsShortcutLabel } from "./useAppShortcuts";

const SCOPES: readonly SearchScope[] = ["all", "work", "commands"];
const BACKFILL_CONCURRENCY = 4;

const paletteBackfill = createPaletteBackfill({
	listWorkspaces: (projectId) =>
		getTransport().request("workspace.list", { projectId, includeDiffStats: false }),
	concurrency: BACKFILL_CONCURRENCY,
});

const paletteNavigator = createPaletteNavigator(async (projectId) =>
	mergeProjectWorkspaces(
		projectId,
		await getTransport().request("workspace.list", { projectId, includeDiffStats: false }),
	),
);

function useWorkspaceBackfill(): void {
	useEffect(() => paletteBackfill.watch(), []);
}

export interface SearchPaletteOptions {
	readonly openNewWorkspace: (projectId: string) => void;
	readonly toggleProjectsHome: () => void;
	readonly pickAndOpenProject: () => Promise<void>;
	readonly enterHostPath: () => void;
	readonly startNewProject: () => void;
	readonly hasUpdateSettings: boolean;
}

export function useSearchPalette(options: SearchPaletteOptions): SearchPaletteProps {
	const t = useT();
	const status = useAppStore((s) => s.status);
	const welcomeGeneration = useAppStore((s) => s.welcomeGeneration);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const projects = useAppStore((s) => s.projects);
	const workspaces = useAppStore((s) => s.workspaces);
	const sessionStateByWorkspace = useAppStore((s) => s.sessionStateByWorkspace);
	const layoutDocumentsByWorkspace = useAppStore((s) => s.layoutDocumentsByWorkspace);
	const closedChatsByWorkspace = useAppStore((s) => s.closedChatsByWorkspace);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const contextProject = useAppStore(selectContextProject);
	const historySessionId = useAppStore((s) => selectHistoryTarget(s)?.sessionId ?? null);
	const readAction = useAppStore((s) =>
		activeWorkspaceId && supportsWorkspaceReadState(s.protocolVersion)
			? selectWorkspaceReadAction(s, activeWorkspaceId)
			: null,
	);
	const [now] = useState(Date.now);
	const settled = useAppStore((s) => {
		const workspace = selectActiveWorkspace(s);
		return workspace ? selectWorkspaceSettledReason(s, workspace, now) !== null : false;
	});
	const settleBlocked = useAppStore(
		(s) => s.activeWorkspaceId !== null && selectWorkspaceSettleBlocked(s, s.activeWorkspaceId),
	);
	useWorkspaceBackfill();
	const firstPrompts = useAppStore(useShallow(selectRecordFirstPrompts));
	const settingsGroups = useMemo(
		() => settingsNavGroups(protocolVersion, options.hasUpdateSettings),
		[protocolVersion, options.hasUpdateSettings],
	);
	const editors = useEditors();
	const [nativeShortcuts] = useState(() => readSettingsShortcutLabel() !== null);

	const online = status === "connected" && welcomeGeneration > 0 && protocolVersion !== null;

	const binding = useMemo(() => {
		const store = () => useAppStore.getState();
		const deps: PaletteCatalogDeps = {
			t,
			contextProjectId: contextProject?.id ?? null,
			activeWorkspace,
			editors,
			historyAvailable: historySessionId !== null,
			canCreateProject: selectSupportsOnboarding({ protocolVersion }),
			nativeShortcuts,
			readAction,
			canSettle: activeWorkspace !== null && canSettleWorkspace(protocolVersion, activeWorkspace),
			settled,
			settleBlocked,
			settingsGroups,
			actions: {
				newWorkspace: options.openNewWorkspace,
				openDefaultWorkspace: (projectId) =>
					void enterDefaultWorkspace(projectId, paletteNavigator.beginPick()),
				openProject: () => void options.pickAndOpenProject(),
				openProjectPath: options.enterHostPath,
				createProject: options.startNewProject,
				newChat: (workspaceId) => void startChatInTab(workspaceId),
				newTerminal: (workspaceId) => store().addTerminal(workspaceId),
				toggleLeft: () => toggleLeftSide(options.toggleProjectsHome),
				toggleRight: toggleRightSide,
				toggleBottom: toggleBottomPanel,
				showTool: (workspaceId, tool) => store().requestToolView(workspaceId, tool),
				openHistory: openChatHistory,
				markRead: markWorkspaceRead,
				markUnread: markWorkspaceUnread,
				settle: settleWorkspace,
				unsettle: unsettleWorkspace,
				reveal: revealWorkspace,
				copyPath: (workspace) => void copyText(workspace.worktreePath),
				openIn: openWorkspaceIn,
				openSettings: (section?: SettingsSection) => store().openSettings(section),
			},
		};
		const workItems = buildWorkItems({
			t,
			state: {
				projects,
				workspaces,
				sessionStateByWorkspace,
				layoutDocumentsByWorkspace,
				closedChatsByWorkspace,
				activeWorkspaceId,
			},
			contextProjectId: contextProject?.id ?? null,
			firstPrompts,
			navigateToProject: (projectId) => {
				paletteNavigator.beginPick();
				goToProjectHome(projectId);
			},
			navigateToWorkspace: (workspace, sessionId) =>
				void paletteNavigator.navigateToWorkspace(workspace, sessionId),
		});
		const rootItems: PaletteItem[] = [
			...commandItems(t, buildCommands(deps), online),
			...buildSettingsItems(deps),
			...workItems,
		];
		const switcherGroups = selectSwitcherGroups({
			projects,
			workspaces,
			sessionStateByWorkspace,
			layoutDocumentsByWorkspace,
			closedChatsByWorkspace,
		});
		const waiting = waitingItems(
			switcherGroups.flatMap((group) => group.sessions),
			workItems,
		);
		const byId = new Map(rootItems.map((item) => [item.id, item]));
		const actions = emptyStateActionIds()
			.map((id) => byId.get(id))
			.filter((item): item is PaletteItem => item !== undefined);
		return { rootItems, waiting, actions };
	}, [
		t,
		online,
		settingsGroups,
		activeWorkspace,
		historySessionId,
		readAction,
		protocolVersion,
		settled,
		settleBlocked,
		nativeShortcuts,
		options,
		contextProject,
		editors,
		projects,
		workspaces,
		sessionStateByWorkspace,
		closedChatsByWorkspace,
		layoutDocumentsByWorkspace,
		activeWorkspaceId,
		firstPrompts,
	]);

	return {
		onClose: () => useAppStore.getState().closeSearch(),
		scopes: SCOPES,
		...(online
			? {}
			: {
					notice: t(
						status === "disconnected" ? "search.palette.offline" : "search.palette.connecting",
					),
				}),
		...binding,
	};
}
