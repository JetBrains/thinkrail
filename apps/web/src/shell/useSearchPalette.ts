import { t as globalT, useT } from "@thinkrail/locales/react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { copyText } from "../lib";
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
	type PaletteHost,
	type PaletteItem,
	type PaletteStart,
	type SearchPaletteProps,
	type SearchScope,
	waitingItems,
} from "../search";
import {
	type SettingsSection,
	selectActiveWorkspace,
	selectContextProject,
	selectHistoryTarget,
	selectHostReachable,
	selectHostSearchAvailable,
	selectRecordFirstPrompts,
	selectSupportsOnboarding,
	selectWorkspaceReadAction,
	selectWorkspaceSettleBlocked,
	selectWorkspaceSettledReason,
	supportsWorkspaceReadState,
	toast,
	useAppStore,
	workspaceName,
} from "../store";
import { errorText, getTransport } from "../transport";
import {
	openChatHistory,
	toggleBottomPanel,
	toggleLeftSide,
	toggleRightSide,
} from "./chordActions";
import { type HostHitTargets, openHostHit } from "./openHostHit";
import { createPaletteBackfill, mergeProjectWorkspaces } from "./paletteBackfill";
import {
	buildCommands,
	buildSettingsItems,
	emptyStateActionIds,
	type PaletteCatalogDeps,
} from "./paletteCatalog";
import { createPaletteNavigator } from "./paletteNavigation";
import { readSettingsShortcutLabel } from "./useAppShortcuts";

const LOCAL_SCOPES: readonly SearchScope[] = ["all", "work", "commands"];
const HOST_SCOPES: readonly SearchScope[] = ["all", "work", "files", "specs", "commands"];
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

const hostHitTargets: HostHitTargets = {
	navigateToWorkspace: paletteNavigator.navigateToWorkspace,
	loadWorkspaceRow: paletteNavigator.loadWorkspaceRow,
	openFile: (workspaceId, path) => openFileInTab(workspaceId, path, "keep"),
	openSpec: (workspaceId, path) => useAppStore.getState().requestSpecView(workspaceId, path),
	openChatLocation: (location) => useAppStore.getState().requestChatLocation(location),
	openPlan: (workspaceId) => useAppStore.getState().requestToolView(workspaceId, "plan"),
};

export interface SearchPaletteOptions {
	readonly openNewWorkspace: (projectId: string, initialPrompt?: string) => boolean;
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

	const online = useAppStore(selectHostReachable);
	const hostSearch = useAppStore(selectHostSearchAvailable);
	const host = useMemo<PaletteHost | undefined>(() => {
		if (!hostSearch) return undefined;
		const names = new Map(projects.map((project) => [project.id, project.name]));
		const workspaceNames = new Map<string, string>();
		for (const list of Object.values(workspaces)) {
			for (const workspace of list) workspaceNames.set(workspace.id, workspaceName(t, workspace));
		}
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
			workspaceName: (workspaceId) => workspaceNames.get(workspaceId),
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
			contextProject
				? { openDialog: (text) => openNewWorkspace(contextProject.id, text) }
				: undefined,
		[contextProject, openNewWorkspace],
	);

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
		hostSearch,
	]);

	return {
		onClose: () => useAppStore.getState().closeSearch(),
		scopes: hostSearch && contextProject ? HOST_SCOPES : LOCAL_SCOPES,
		...(host ? { host } : {}),
		...(start ? { start } : {}),
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
