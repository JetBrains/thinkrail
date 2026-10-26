import {
	RiChat3Line,
	RiExternalLinkLine,
	RiFileCopyLine,
	RiHome4Line,
	RiTerminalBoxLine,
} from "@remixicon/react";
import type { SearchContext, Workspace } from "@thinkrail/contracts";
import { t as globalT, useT } from "@thinkrail/locales/react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Command, CommandContext } from "../commands";
import { copyText } from "../lib";
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
	type PaletteHost,
	type PaletteItem,
	type PaletteStart,
	type SearchPaletteProps,
	type SearchScope,
	waitingItems,
} from "../search";
import {
	isDefaultWorkspace,
	selectActiveWorkspace,
	selectContextProject,
	selectContextRepoProject,
	selectHistoryTarget,
	selectRecordFirstPrompts,
	selectSupportsOnboarding,
	selectSwitcherGroups,
	selectWorkspaceIsRunning,
	selectWorkspaceNeedsAttention,
	selectWorkspaceReadAction,
	selectWorkspaceSettledReason,
	supportsWorkspaceReadState,
	toast,
	useAppStore,
	workspaceName,
} from "../store";
import { errorText, getTransport, supportsHostSearch, wsErrorCode } from "../transport";
import { type HostHitTargets, openHostHit } from "./openHostHit";
import { createPaletteBackfill, mergeProjectWorkspaces } from "./paletteBackfill";
import {
	buildCommands,
	buildSettingsItems,
	emptyStateActionIds,
	type PaletteTool,
} from "./paletteCatalog";
import { createPaletteNavigator } from "./paletteNavigation";
import { readSettingsShortcutLabel } from "./useAppShortcuts";

export function paletteSearchContext(
	contextProjectId: string | null,
	activeWorkspaceId: string | null,
	workspaces: Readonly<Record<string, readonly Workspace[]>>,
): SearchContext {
	const workspaceId =
		activeWorkspaceId ??
		(contextProjectId ? workspaces[contextProjectId]?.find(isDefaultWorkspace)?.id : undefined);
	return {
		...(contextProjectId ? { projectId: contextProjectId } : {}),
		...(workspaceId ? { workspaceId } : {}),
	};
}

const LOCAL_SCOPES: readonly SearchScope[] = ["all", "work", "commands"];
const HOST_SCOPES: readonly SearchScope[] = ["all", "work", "files", "specs", "commands"];
const BACKFILL_CONCURRENCY = 4;

const paletteBackfill = createPaletteBackfill({
	listSessions: (workspaceId) => getTransport().request("session.list", { workspaceId }),
	listWorkspaces: (projectId) =>
		getTransport().request("workspace.list", { projectId, includeDiffStats: false }),
	isRefusal: (error) => wsErrorCode(error) !== undefined,
	concurrency: BACKFILL_CONCURRENCY,
});

const paletteNavigator = createPaletteNavigator(async (projectId) =>
	mergeProjectWorkspaces(
		projectId,
		await getTransport().request("workspace.list", { projectId, includeDiffStats: false }),
	),
);

function useChatTitleBackfill(): void {
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
	readonly openNewWorkspace: (projectId: string | null, initialPrompt?: string) => void;
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
	const contextRepoProject = useAppStore(selectContextRepoProject);
	const canStartChat = useAppStore(canStartProjectlessChat);
	const historySessionId = useAppStore((s) => selectHistoryTarget(s)?.sessionId ?? null);
	const readAction = useAppStore((s) =>
		activeWorkspaceId && supportsWorkspaceReadState(s.protocolVersion)
			? selectWorkspaceReadAction(s, activeWorkspaceId)
			: null,
	);
	const settled = useAppStore((s) => {
		const workspace = selectActiveWorkspace(s);
		return workspace ? selectWorkspaceSettledReason(s, workspace, Date.now()) !== null : false;
	});
	const settleBlocked = useAppStore(
		(s) =>
			s.activeWorkspaceId !== null &&
			(selectWorkspaceIsRunning(s, s.activeWorkspaceId) ||
				selectWorkspaceNeedsAttention(s, s.activeWorkspaceId)),
	);
	useChatTitleBackfill();
	const firstPrompts = useAppStore(useShallow(selectRecordFirstPrompts));
	const settingsGroups = useMemo(
		() => settingsNavGroups(protocolVersion, options.hasUpdateSettings),
		[protocolVersion, options.hasUpdateSettings],
	);
	const editors = useEditors();
	const [settingsShortcut] = useState(() => readSettingsShortcutLabel() !== null);

	const online = status === "connected" && welcomeGeneration > 0 && protocolVersion !== null;
	const hostSearch = online && supportsHostSearch(protocolVersion);
	const host = useMemo<PaletteHost | undefined>(() => {
		if (!hostSearch) return undefined;
		const names = new Map(projects.map((project) => [project.id, project.name]));
		const workspaceNames = new Map<string, string>();
		for (const list of Object.values(workspaces)) {
			for (const workspace of list) workspaceNames.set(workspace.id, workspaceName(t, workspace));
		}
		return {
			context: paletteSearchContext(contextProject?.id ?? null, activeWorkspaceId, workspaces),
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
	const context: CommandContext = useMemo(
		() => ({
			online,
			projectId: contextRepoProject?.id ?? null,
			workspaceId: activeWorkspaceId,
			protocolVersion,
		}),
		[online, contextRepoProject, activeWorkspaceId, protocolVersion],
	);
	const openNewWorkspace = options.openNewWorkspace;
	const start = useMemo<PaletteStart | undefined>(
		() =>
			contextRepoProject || canStartChat
				? { openDialog: (text) => openNewWorkspace(contextRepoProject?.id ?? null, text) }
				: undefined,
		[contextRepoProject, canStartChat, openNewWorkspace],
	);

	const binding = useMemo(() => {
		const store = () => useAppStore.getState();
		const deps = {
			t,
			context,
			activeWorkspace,
			historyAvailable: historySessionId !== null,
			canCreateProject: selectSupportsOnboarding({ protocolVersion }),
			settingsShortcut,
			readAction,
			canSettle: activeWorkspace !== null && canSettleWorkspace(protocolVersion, activeWorkspace),
			settled,
			settleBlocked,
			settingsGroups,
			actions: {
				newWorkspace: options.openNewWorkspace,
				openProject: () => void options.pickAndOpenProject(),
				openProjectPath: options.enterHostPath,
				createProject: options.startNewProject,
				newChat: (workspaceId: string) => void startChatInTab(workspaceId),
				toggleLeft: () => {
					const workspaceId = store().activeWorkspaceId;
					if (workspaceId)
						store().enqueueLayoutIntent({ kind: "toggle-side", workspaceId, side: "left" });
					else options.toggleProjectsHome();
				},
				toggleRight: (workspaceId: string) =>
					store().enqueueLayoutIntent({ kind: "toggle-side", workspaceId, side: "right" }),
				toggleBottom: (workspaceId: string) =>
					store().enqueueLayoutIntent({ kind: "toggle-bottom", workspaceId }),
				showTool: (workspaceId: string, tool: PaletteTool) =>
					store().requestToolView(workspaceId, tool),
				openHistory: () => {
					const target = selectHistoryTarget(store());
					if (target) store().requestHistoryOpen(target);
				},
				markRead: markWorkspaceRead,
				markUnread: markWorkspaceUnread,
				settle: settleWorkspace,
				unsettle: unsettleWorkspace,
				reveal: revealWorkspace,
				openSettings: (section?: Parameters<ReturnType<typeof store>["openSettings"]>[0]) =>
					store().openSettings(section),
			},
		};
		const commands: Command[] = [
			...buildCommands(deps),
			...(contextRepoProject
				? [
						{
							id: "workspace.openDefault",
							title: t("commands.workspace.openDefault"),
							group: "work" as const,
							icon: RiHome4Line,
							keywords: ["default", "project folder", "no worktree"],
							mutates: true,
							run: () =>
								void enterDefaultWorkspace(contextRepoProject.id, paletteNavigator.beginPick()),
						},
					]
				: []),
			...(canStartChat
				? [
						{
							id: "chat.newProjectless",
							title: t("commands.chat.newProjectless"),
							group: "work" as const,
							icon: RiChat3Line,
							keywords: ["chat", "no project", "scratch", "quick"],
							mutates: true,
							run: () => void startProjectlessChat(),
						},
					]
				: []),
			...(activeWorkspace
				? [
						{
							id: "terminal.new",
							title: t("commands.terminal.new"),
							group: "work" as const,
							icon: RiTerminalBoxLine,
							keywords: ["shell", "console"],
							mutates: true,
							run: () => store().addTerminal(activeWorkspace.id),
						},
						{
							id: "workspace.copyPath",
							title: t("commands.workspace.copyPath"),
							group: "workspace" as const,
							icon: RiFileCopyLine,
							keywords: ["folder", "directory", "worktree"],
							run: () => void copyText(activeWorkspace.worktreePath),
						},
						...editors.map((editor) => ({
							id: `workspace.openIn.${editor.id}`,
							title: t("commands.workspace.openIn", { editor: editor.label }),
							group: "workspace" as const,
							icon: RiExternalLinkLine,
							keywords: ["editor", "ide", editor.label],
							mutates: true,
							run: () => openWorkspaceIn(activeWorkspace, editor),
						})),
					]
				: []),
		];
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
			...commandItems(t, commands, context),
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
		context,
		settingsGroups,
		activeWorkspace,
		historySessionId,
		readAction,
		protocolVersion,
		settled,
		settleBlocked,
		settingsShortcut,
		options,
		contextProject,
		contextRepoProject,
		canStartChat,
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
		scopes: hostSearch && contextProject ? HOST_SCOPES : LOCAL_SCOPES,
		...(host ? { host } : {}),
		...(start ? { start } : {}),
		...(online
			? hostSearch
				? {}
				: { notice: t("search.palette.olderHost") }
			: {
					notice: t(
						status === "disconnected" ? "search.palette.offline" : "search.palette.connecting",
					),
				}),
		...binding,
	};
}
