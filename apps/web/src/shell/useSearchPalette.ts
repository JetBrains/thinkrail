import {
	RiExternalLinkLine,
	RiFileCopyLine,
	RiHome4Line,
	RiTerminalBoxLine,
} from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Command, CommandContext } from "../commands";
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
	selectActiveWorkspace,
	selectContextProject,
	selectHistoryTarget,
	selectKnownChatTitle,
	selectRecordFirstPrompts,
	selectSupportsOnboarding,
	selectSwitcherGroups,
	selectWorkspaceIsRunning,
	selectWorkspaceNeedsAttention,
	selectWorkspaceReadAction,
	selectWorkspaceSettledReason,
	supportsWorkspaceReadState,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { createBackfillQueue } from "./backfillQueue";
import {
	buildCommands,
	buildSettingsItems,
	emptyStateActionIds,
	type PaletteTool,
} from "./paletteCatalog";
import { readSettingsShortcutLabel } from "./useAppShortcuts";

const SCOPES: readonly SearchScope[] = ["all", "work", "commands"];
const BACKFILL_CONCURRENCY = 4;

const backfilledTitles = new Map<string, string>();
const listedSessionSets = new Map<string, string>();
const titleListeners = new Set<() => void>();

function sessionSetKey(workspaceId: string): string {
	return Object.keys(useAppStore.getState().sessionStateByWorkspace[workspaceId] ?? {})
		.sort()
		.join("\u0000");
}

const titleQueue = createBackfillQueue({
	concurrency: BACKFILL_CONCURRENCY,
	isWanted: (workspaceId) => listedSessionSets.get(workspaceId) !== sessionSetKey(workspaceId),
	run: async (workspaceId) => {
		const listed = sessionSetKey(workspaceId);
		try {
			const summaries = await getTransport().request("session.list", { workspaceId });
			for (const summary of summaries) {
				if (summary.title) backfilledTitles.set(summary.sessionId, summary.title);
			}
			for (const listener of titleListeners) listener();
		} finally {
			listedSessionSets.set(workspaceId, listed);
		}
	},
});

const projectQueue = createBackfillQueue({
	concurrency: BACKFILL_CONCURRENCY,
	isWanted: (projectId) => useAppStore.getState().workspaces[projectId] === undefined,
	run: async (projectId) => {
		const rows = await getTransport().request("workspace.list", {
			projectId,
			includeDiffStats: false,
		});
		const store = useAppStore.getState();
		if (
			store.workspaces[projectId] === undefined &&
			store.projects.some((project) => project.id === projectId)
		) {
			store.setWorkspaces(projectId, rows);
		}
	},
});

function navigateToWorkspace(workspace: Pick<Workspace, "id" | "projectId">, sessionId?: string) {
	useAppStore.getState().activateWorkspaceFromRoute(workspace, sessionId);
}

export function backfillOrder(
	state: ReturnType<typeof useAppStore.getState>,
	knownTitles: ReadonlyMap<string, string>,
) {
	const contextProjectId = selectContextProject(state)?.id ?? null;
	const openProjects = new Set(state.projects.map((project) => project.id));
	const known = new Set(
		state.projects.flatMap((project) => (state.workspaces[project.id] ?? []).map((ws) => ws.id)),
	);
	const missingProjects = new Set(
		state.projects
			.filter((project) => state.workspaces[project.id] === undefined)
			.map((project) => project.id),
	);
	const untitled: { workspaceId: string; rank: number }[] = [];
	for (const [workspaceId, records] of Object.entries(state.sessionStateByWorkspace)) {
		const list = Object.values(records);
		const projectId = list[0]?.projectId;
		if (projectId === undefined || !openProjects.has(projectId)) continue;
		if (!known.has(workspaceId)) missingProjects.add(projectId);
		if (
			list.every(
				(record) =>
					knownTitles.has(record.sessionId) ||
					selectKnownChatTitle(state, workspaceId, record.sessionId),
			)
		)
			continue;
		const rank =
			workspaceId === state.activeWorkspaceId ? 0 : projectId === contextProjectId ? 1 : 2;
		untitled.push({ workspaceId, rank });
	}
	untitled.sort((a, b) => a.rank - b.rank);
	return {
		projectIds: [...missingProjects],
		workspaceIds: untitled.map((entry) => entry.workspaceId),
	};
}

function useChatTitleBackfill(): Record<string, string> {
	const [titles, setTitles] = useState(() => Object.fromEntries(backfilledTitles));
	const snapshotKey = useAppStore((s) =>
		[
			s.welcomeGeneration,
			s.projects.map((project) => project.id).join("\u0000"),
			Object.keys(s.sessionStateByWorkspace).sort().join("\u0000"),
		].join("\u0001"),
	);
	useEffect(() => {
		const listener = () => setTitles(Object.fromEntries(backfilledTitles));
		titleListeners.add(listener);
		const { projectIds, workspaceIds } = backfillOrder(useAppStore.getState(), backfilledTitles);
		projectQueue.schedule(projectIds);
		titleQueue.schedule(workspaceIds);
		return () => {
			titleListeners.delete(listener);
			projectQueue.clearPending();
			titleQueue.clearPending();
		};
	}, [snapshotKey]);
	return titles;
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
	const chatTitles = useChatTitleBackfill();
	const firstPrompts = useAppStore(useShallow(selectRecordFirstPrompts));
	const settingsGroups = useMemo(
		() => settingsNavGroups(protocolVersion, options.hasUpdateSettings),
		[protocolVersion, options.hasUpdateSettings],
	);
	const editors = useEditors();
	const [settingsShortcut] = useState(() => readSettingsShortcutLabel() !== null);

	const online = status === "connected" && welcomeGeneration > 0 && protocolVersion !== null;
	const context: CommandContext = useMemo(
		() => ({
			online,
			projectId: contextProject?.id ?? null,
			workspaceId: activeWorkspaceId,
			protocolVersion,
		}),
		[online, contextProject, activeWorkspaceId, protocolVersion],
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
			...(contextProject
				? [
						{
							id: "workspace.openDefault",
							title: t("commands.workspace.openDefault"),
							group: "work" as const,
							icon: RiHome4Line,
							keywords: ["default", "project folder", "no worktree"],
							mutates: true,
							run: () => void enterDefaultWorkspace(contextProject.id),
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
			chatTitles,
			firstPrompts,
			navigateToProject: goToProjectHome,
			navigateToWorkspace,
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
		editors,
		projects,
		workspaces,
		sessionStateByWorkspace,
		closedChatsByWorkspace,
		layoutDocumentsByWorkspace,
		activeWorkspaceId,
		chatTitles,
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
