import { t as globalT, useT } from "@thinkrail/locales/react";
import { toggleActiveVimMode } from "@thinkrail/resource-renderers";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { openFindInFiles } from "../findInFiles";
import { chatDisplayName, copyText } from "../lib";
import { canStartProjectlessChat, startProjectlessChat } from "../panels/chatActions";
import { enterDefaultWorkspace } from "../panels/defaultWorkspace";
import { startChatInTab } from "../panels/openChat";
import { openFileInTab } from "../panels/openTabs";
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
	type PaletteAsk,
	type PaletteHost,
	type PaletteItem,
	type PaletteStart,
	type SearchPaletteProps,
	type SearchScope,
	waitingItems,
} from "../search";
import {
	isChatsContainer,
	isChatWorkspace,
	isDefaultWorkspace,
	type SettingsSection,
	selectActiveWorkspace,
	selectChatWorkspaceFirstPrompt,
	selectChatWorkspaceTitle,
	selectContextProject,
	selectContextRepoProject,
	selectHasTextSearchScope,
	selectHistoryTarget,
	selectHostReachable,
	selectHostSearchAvailable,
	selectRecordFirstPrompts,
	selectSupportsOnboarding,
	selectWorkspaceById,
	selectWorkspaceReadAction,
	selectWorkspaceSettleBlocked,
	selectWorkspaceSettledReason,
	supportsWorkspaceReadState,
	toast,
	useAppStore,
	workspaceName,
} from "../store";
import { errorText, getTransport, supportsTextSearch } from "../transport";
import {
	focusCenterGroup,
	focusChatComposer,
	focusProjects,
	focusTerminal,
	openChatHistory,
	showFiles,
	toggleBottomPanel,
	toggleLeftSide,
	toggleRightSide,
} from "./chordActions";
import { collectCenterGroups } from "./layout";
import { readNativePageZoomBridge } from "./nativePageZoom";
import { type HostHitTargets, openHostHit } from "./openHostHit";
import { createPaletteBackfill } from "./paletteBackfill";
import {
	buildCommands,
	buildSettingsItems,
	emptyStateActionIds,
	type PaletteCatalogDeps,
} from "./paletteCatalog";
import { paletteNavigator } from "./paletteNavigation";
import { focusAdjacentRegion } from "./regions";
import { readSettingsShortcutLabel } from "./useAppShortcuts";
import { activeTabActions, runActiveTabAction } from "./workbenchCommands";

const LOCAL_SCOPES: readonly SearchScope[] = ["all", "work", "commands"];
const HOST_SCOPES: readonly SearchScope[] = ["all", "work", "files", "specs", "commands"];
const CHAT_SCOPES: readonly SearchScope[] = ["all", "work", "files", "commands"];
const BACKFILL_CONCURRENCY = 4;

const paletteBackfill = createPaletteBackfill({
	listWorkspaces: (projectId) =>
		getTransport().request("workspace.list", { projectId, includeDiffStats: false }),
	concurrency: BACKFILL_CONCURRENCY,
});

function useWorkspaceBackfill(): void {
	useEffect(() => paletteBackfill.watch(), []);
}

const hostHitTargets: HostHitTargets = {
	navigateToWorkspace: paletteNavigator.navigateToWorkspace,
	loadWorkspaceRow: paletteNavigator.loadWorkspaceRow,
	openFile: (workspaceId, path) => openFileInTab(workspaceId, path, "keep"),
	openSpec: (workspaceId, path, line) =>
		useAppStore.getState().requestSpecView(workspaceId, path, line),
	openChatLocation: (location) => useAppStore.getState().requestChatLocation(location),
	openPlan: (workspaceId) => useAppStore.getState().requestToolView(workspaceId, "plan"),
};

export async function askTheAgent(
	workspaceId: string | null,
	projectId: string | null,
	text: string,
	stillWanted: () => boolean = paletteNavigator.beginPick(),
): Promise<void> {
	const target =
		workspaceId ??
		(projectId ? ((await enterDefaultWorkspace(projectId, stillWanted))?.id ?? null) : null);
	if (target) await startChatInTab(target, { prompt: `${text}\n\n${globalT("search.ask.note")}` });
}

export interface SearchPaletteOptions {
	readonly openNewWorkspace: (projectId: string | null, initialPrompt?: string) => boolean;
	readonly toggleProjectsHome: () => void;
	readonly pickAndOpenProject: () => Promise<void>;
	readonly enterHostPath: () => void;
	readonly startNewProject: () => void;
	readonly hasUpdateSettings: boolean;
	readonly renderFilePreview: PaletteHost["renderFilePreview"];
}

export function useSearchPalette(options: SearchPaletteOptions): SearchPaletteProps {
	const t = useT();
	const status = useAppStore((s) => s.status);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const projects = useAppStore((s) => s.projects);
	const workspaces = useAppStore((s) => s.workspaces);
	const sessionStateByWorkspace = useAppStore((s) => s.sessionStateByWorkspace);
	const layoutDocumentsByWorkspace = useAppStore((s) => s.layoutDocumentsByWorkspace);
	const closedChatsByWorkspace = useAppStore((s) => s.closedChatsByWorkspace);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const contextProject = useAppStore(selectContextProject);
	const contextRepoProject = useAppStore(selectContextRepoProject);
	const textSearchScoped = useAppStore(selectHasTextSearchScope);
	const canStartChat = useAppStore(canStartProjectlessChat);
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
	const [pageZoom] = useState(readNativePageZoomBridge);
	const [tabActions] = useState(activeTabActions);

	const online = useAppStore(selectHostReachable);
	const hostSearch = useAppStore(selectHostSearchAvailable);
	const host = useMemo<PaletteHost | undefined>(() => {
		if (!hostSearch) return undefined;
		const names = new Map(
			projects.map((project) => [
				project.id,
				isChatsContainer(project) ? t("panels.chats.title") : project.name,
			]),
		);
		const workspaceNames = new Map<string, string>();
		for (const list of Object.values(workspaces)) {
			for (const workspace of list) {
				if (!isChatWorkspace(workspace))
					workspaceNames.set(workspace.id, workspaceName(t, workspace));
			}
		}
		const chatName = (workspaceId: string) => {
			const state = useAppStore.getState();
			const workspace = selectWorkspaceById(state, workspaceId);
			if (!workspace || !isChatWorkspace(workspace)) return undefined;
			return chatDisplayName(
				t,
				selectChatWorkspaceTitle(state, workspaceId),
				selectChatWorkspaceFirstPrompt(state, workspaceId),
			);
		};
		return {
			context: {
				...(contextProject ? { projectId: contextProject.id } : {}),
				...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
			},
			openHit: (hit) => {
				void openHostHit(hit, hostHitTargets).catch((err: unknown) =>
					toast.error(errorText(err, globalT("search.item.openFailed"))),
				);
			},
			projectName: (projectId) => names.get(projectId),
			workspaceName: (workspaceId) => workspaceNames.get(workspaceId) ?? chatName(workspaceId),
			renderFilePreview: options.renderFilePreview,
		};
	}, [
		hostSearch,
		projects,
		workspaces,
		contextProject,
		activeWorkspaceId,
		t,
		options.renderFilePreview,
	]);

	const openNewWorkspace = options.openNewWorkspace;
	const start = useMemo<PaletteStart | undefined>(
		() =>
			contextRepoProject || canStartChat
				? { openDialog: (text) => openNewWorkspace(contextRepoProject?.id ?? null, text) }
				: undefined,
		[contextRepoProject, canStartChat, openNewWorkspace],
	);

	const ask = useMemo<PaletteAsk | undefined>(() => {
		const projectId = contextRepoProject?.id ?? null;
		if (!hostSearch || (!activeWorkspaceId && !projectId)) return undefined;
		const target =
			activeWorkspace ??
			(projectId ? workspaces[projectId]?.find(isDefaultWorkspace) : undefined) ??
			null;
		return {
			ask: (text) => void askTheAgent(activeWorkspaceId, projectId, text),
			...(target ? { target: workspaceName(t, target) } : {}),
		};
	}, [hostSearch, activeWorkspaceId, activeWorkspace, contextRepoProject, workspaces, t]);

	const binding = useMemo(() => {
		const store = () => useAppStore.getState();
		const activeLayout = activeWorkspaceId ? layoutDocumentsByWorkspace[activeWorkspaceId] : null;
		const deps: PaletteCatalogDeps = {
			t,
			contextProjectId: contextRepoProject?.id ?? null,
			canStartChat,
			activeWorkspace,
			editors,
			historyAvailable: historySessionId !== null,
			canCreateProject: selectSupportsOnboarding({ protocolVersion }),
			nativeShortcuts,
			pageZoom,
			findInFilesAvailable: supportsTextSearch(protocolVersion) && textSearchScoped,
			changesAvailable: activeWorkspace !== null && !isChatWorkspace(activeWorkspace),
			centerGroupCount: activeLayout ? collectCenterGroups(activeLayout.center).length : 0,
			readAction,
			canSettle: activeWorkspace !== null && canSettleWorkspace(protocolVersion, activeWorkspace),
			settled,
			settleBlocked,
			settingsGroups,
			tabActions,
			actions: {
				newWorkspace: options.openNewWorkspace,
				newProjectlessChat: () => void startProjectlessChat(),
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
				toggleVim: toggleActiveVimMode,
				showTool: (workspaceId, tool) => store().requestToolView(workspaceId, tool),
				showFiles,
				focusRegion: focusAdjacentRegion,
				focusComposer: focusChatComposer,
				focusProjects: () => focusProjects(options.toggleProjectsHome),
				focusTerminal,
				focusGroup: focusCenterGroup,
				openHistory: openChatHistory,
				findInFiles: openFindInFiles,
				markRead: markWorkspaceRead,
				markUnread: markWorkspaceUnread,
				settle: settleWorkspace,
				unsettle: unsettleWorkspace,
				reveal: revealWorkspace,
				copyPath: (workspace) => void copyText(workspace.worktreePath),
				openIn: openWorkspaceIn,
				openSettings: (section?: SettingsSection) => store().openSettings(section),
				runTabAction: runActiveTabAction,
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
			transcriptPreviews: hostSearch,
			navigateToProject: (projectId) => {
				paletteNavigator.beginPick();
				goToProjectHome(projectId);
			},
			navigateToWorkspace: (workspace, sessionId) =>
				void paletteNavigator.navigateToWorkspace(workspace, sessionId).then((opened) => {
					if (opened) store().requestComposerFocus(workspace.id, sessionId);
				}),
		});
		const rootItems: PaletteItem[] = [
			...commandItems(t, buildCommands(deps), online),
			...buildSettingsItems(deps),
			...workItems,
		];
		const waiting = waitingItems(workItems);
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
		pageZoom,
		tabActions,
		options,
		contextProject,
		contextRepoProject,
		canStartChat,
		textSearchScoped,
		editors,
		projects,
		workspaces,
		sessionStateByWorkspace,
		closedChatsByWorkspace,
		layoutDocumentsByWorkspace,
		activeWorkspaceId,
		firstPrompts,
		hostSearch,
	]);

	return {
		onClose: () => useAppStore.getState().closeSearch(),
		scopes:
			hostSearch && contextProject
				? isChatsContainer(contextProject)
					? CHAT_SCOPES
					: HOST_SCOPES
				: LOCAL_SCOPES,
		...(host ? { host } : {}),
		...(start ? { start } : {}),
		...(ask ? { ask } : {}),
		...(online
			? hostSearch
				? {}
				: { notice: { kind: "info", text: t("search.palette.olderHost") } }
			: {
					notice: {
						kind: "offline",
						text: t(
							status === "disconnected" ? "search.palette.offline" : "search.palette.connecting",
						),
					},
				}),
		...binding,
	};
}
