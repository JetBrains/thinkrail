import {
	RiAddLine,
	RiExternalLinkLine,
	RiFileCopyLine,
	RiFolderOpenLine,
	RiHome4Line,
	RiTerminalBoxLine,
} from "@remixicon/react";
import type { ExtensionCatalogEntry, Workspace } from "@thinkrail/contracts";
import { t as globalT, type Translator, useT } from "@thinkrail/locales/react";
import { useEffect, useMemo, useState } from "react";
import type { Command, CommandContext } from "../commands";
import { copyText } from "../lib";
import { enterDefaultWorkspace } from "../panels/defaultWorkspace";
import { setExtensionEnabled } from "../panels/ExtensionsSettings";
import { setMcpServerEnabled } from "../panels/McpSettings";
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
	type PaletteAction,
	type PaletteItem,
	type SearchPaletteProps,
	type SearchScope,
	waitingItems,
} from "../search";
import {
	deriveMcpServerRows,
	selectActiveWorkspace,
	selectContextProject,
	selectHistoryTarget,
	selectKnownChatTitle,
	selectSwitcherGroups,
	selectWorkspaceReadAction,
	selectWorkspaceSettledReason,
	supportsWorkspaceReadState,
	toast,
	useAppStore,
} from "../store";
import { getThemes } from "../themes";
import { errorText, getTransport, requestMcpList } from "../transport";
import {
	buildCommands,
	buildPages,
	buildSettingsItems,
	emptyStateActionIds,
	type PaletteTool,
} from "./paletteCatalog";

const SCOPES: readonly SearchScope[] = ["all", "work", "commands"];
const TITLE_BACKFILL_WORKSPACES = 24;

function navigateToWorkspace(workspace: Pick<Workspace, "id" | "projectId">, sessionId?: string) {
	useAppStore.getState().activateWorkspaceFromRoute(workspace, sessionId);
}

function backfillOrder(state: ReturnType<typeof useAppStore.getState>) {
	const contextProjectId = selectContextProject(state)?.id ?? null;
	const openProjects = new Set(state.projects.map((project) => project.id));
	const known = new Set(
		state.projects.flatMap((project) => (state.workspaces[project.id] ?? []).map((ws) => ws.id)),
	);
	const missingProjects = new Set<string>();
	const untitled: { workspaceId: string; rank: number }[] = [];
	for (const [workspaceId, records] of Object.entries(state.sessionStateByWorkspace)) {
		const list = Object.values(records);
		const projectId = list[0]?.projectId;
		if (projectId === undefined || !openProjects.has(projectId)) continue;
		if (!known.has(workspaceId)) missingProjects.add(projectId);
		if (list.every((record) => selectKnownChatTitle(state, workspaceId, record.sessionId)))
			continue;
		const rank =
			workspaceId === state.activeWorkspaceId ? 0 : projectId === contextProjectId ? 1 : 2;
		untitled.push({ workspaceId, rank });
	}
	untitled.sort((a, b) => a.rank - b.rank);
	return {
		missingProjects,
		workspaceIds: untitled.slice(0, TITLE_BACKFILL_WORKSPACES).map((entry) => entry.workspaceId),
	};
}

function useChatTitleBackfill(): Record<string, string> {
	const [titles, setTitles] = useState<Record<string, string>>({});
	useEffect(() => {
		let cancelled = false;
		const { missingProjects, workspaceIds } = backfillOrder(useAppStore.getState());
		for (const projectId of missingProjects) {
			void getTransport()
				.request("workspace.list", { projectId })
				.then((rows) => useAppStore.getState().setWorkspaces(projectId, rows))
				.catch(() => {});
		}
		for (const workspaceId of workspaceIds) {
			void getTransport()
				.request("session.list", { workspaceId })
				.then((summaries) => {
					if (cancelled) return;
					setTitles((previous) => {
						const next = { ...previous };
						for (const summary of summaries)
							if (summary.title) next[summary.sessionId] = summary.title;
						return next;
					});
				})
				.catch(() => {});
		}
		return () => {
			cancelled = true;
		};
	}, []);
	return titles;
}

function useExtensionCatalog(): ExtensionCatalogEntry[] | null {
	const [entries, setEntries] = useState<ExtensionCatalogEntry[] | null>(null);
	useEffect(() => {
		let current = true;
		void getTransport()
			.request("extension.list", {})
			.then((catalog) => {
				if (current) setEntries(catalog);
			})
			.catch(() => {
				if (current) setEntries([]);
			});
		return () => {
			current = false;
		};
	}, []);
	return entries;
}

export interface SearchPaletteOptions {
	readonly openNewWorkspace: (projectId: string) => void;
	readonly toggleProjectsHome: () => void;
	readonly pickAndOpenProject: () => Promise<void>;
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
	const activeWorkspaceLiveLatch = useAppStore((s) => s.activeWorkspaceLiveLatch);
	const workspaceSettlingSupported = useAppStore((s) => s.workspaceSettlingSupported);
	const settleIdleDays = useAppStore((s) => s.settleIdleDays);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const contextProject = useAppStore(selectContextProject);
	const historySessionId = useAppStore((s) => selectHistoryTarget(s)?.sessionId ?? null);
	const theme = useAppStore((s) => s.theme);
	const disabledExtensions = useAppStore((s) => s.disabledExtensions);
	const doubleShift = useAppStore((s) => s.doubleShiftSearch);
	const mcpProjection = useAppStore((s) =>
		activeWorkspaceId ? s.mcpByWorkspace[activeWorkspaceId] : undefined,
	);
	const projectTrusted = useAppStore(
		(s) =>
			s.projects.find((project) => project.id === selectActiveWorkspace(s)?.projectId)
				?.piResourceTrust === "granted",
	);
	const readAction = useAppStore((s) =>
		activeWorkspaceId && supportsWorkspaceReadState(s.protocolVersion)
			? selectWorkspaceReadAction(s, activeWorkspaceId)
			: null,
	);
	const settled = useAppStore((s) => {
		const workspace = selectActiveWorkspace(s);
		return workspace ? selectWorkspaceSettledReason(s, workspace, Date.now()) !== null : false;
	});
	const chatTitles = useChatTitleBackfill();
	const extensions = useExtensionCatalog();
	const editors = useEditors();
	const [nowMs] = useState(Date.now);
	useEffect(() => {
		if (!activeWorkspaceId) return;
		void requestMcpList("mcp.list", { workspaceId: activeWorkspaceId }).catch(() => {});
	}, [activeWorkspaceId]);

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
			readAction,
			canSettle: activeWorkspace !== null && canSettleWorkspace(protocolVersion, activeWorkspace),
			settled,
			settingsGroups: settingsNavGroups(protocolVersion, options.hasUpdateSettings),
			themes: getThemes(),
			theme,
			extensions,
			disabledExtensions,
			mcpRows: mcpProjection
				? deriveMcpServerRows(mcpProjection, nowMs).filter(
						(row) => projectTrusted || row.summary.scope !== "project",
					)
				: null,
			nowMs,
			doubleShift,
			actions: {
				newWorkspace: options.openNewWorkspace,
				openProject: () => void options.pickAndOpenProject(),
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
				setTheme: (id: string) => {
					void getTransport()
						.request("settings.update", { config: { theme: id, themeMode: "fixed" } })
						.catch((err: unknown) =>
							toast.error(errorText(err, globalT("commands.settings.themeFailed"))),
						);
				},
				setExtensionEnabled: (name: string, enabled: boolean) => {
					void setExtensionEnabled(name, enabled).catch(() =>
						toast.error(globalT("commands.settings.extensionFailed")),
					);
				},
				setMcpEnabled: (row: Parameters<typeof setMcpServerEnabled>[1], enabled: boolean) => {
					const workspaceId = store().activeWorkspaceId;
					if (!workspaceId) return;
					void setMcpServerEnabled(workspaceId, row, enabled).catch((err: unknown) =>
						toast.error(errorText(err, globalT("commands.settings.mcpFailed"))),
					);
				},
				setDoubleShift: (enabled: boolean) => store().setDoubleShiftSearch(enabled),
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
				activeWorkspaceLiveLatch,
				workspaceSettlingSupported,
				settleIdleDays,
			},
			contextProjectId: contextProject?.id ?? null,
			chatTitles,
			nowMs,
			navigateToProject: goToProjectHome,
			navigateToWorkspace,
		}).map((item) => withActions(t, item, deps.actions.newWorkspace));
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
		return {
			rootItems,
			waiting,
			actions,
			pages: buildPages(deps),
		};
	}, [
		t,
		context,
		activeWorkspace,
		historySessionId,
		readAction,
		protocolVersion,
		settled,
		theme,
		extensions,
		disabledExtensions,
		mcpProjection,
		projectTrusted,
		nowMs,
		doubleShift,
		options,
		contextProject,
		editors,
		projects,
		workspaces,
		sessionStateByWorkspace,
		closedChatsByWorkspace,
		layoutDocumentsByWorkspace,
		activeWorkspaceId,
		activeWorkspaceLiveLatch,
		workspaceSettlingSupported,
		settleIdleDays,
		chatTitles,
	]);

	return {
		onClose: () => useAppStore.getState().closeSearch(),
		scopes: SCOPES,
		...(online ? {} : { notice: t("search.palette.offline") }),
		...binding,
	};
}

function withActions(
	t: Translator,
	item: PaletteItem,
	newWorkspace: (projectId: string) => void,
): PaletteItem {
	if (item.kind === "project" && item.projectId) {
		const projectId = item.projectId;
		const actions: readonly PaletteAction[] = [
			{
				id: "open",
				title: t("commands.rowActions.openProjectHome"),
				icon: RiFolderOpenLine,
				run: () => item.run?.(),
			},
			{
				id: "new-workspace",
				title: t("commands.rowActions.newWorkspace"),
				icon: RiAddLine,
				shortcut: { key: "N", mod: true },
				run: () => newWorkspace(projectId),
			},
		];
		return { ...item, actions: () => actions };
	}
	if (item.kind === "workspace" && item.workspaceId && item.projectId) {
		const workspace = { id: item.workspaceId, projectId: item.projectId };
		const actions: readonly PaletteAction[] = [
			{
				id: "open",
				title: t("commands.rowActions.openWorkspace"),
				icon: RiFolderOpenLine,
				run: () => item.run?.(),
			},
			{
				id: "new-workspace",
				title: t("commands.rowActions.newWorkspaceInProject"),
				icon: RiAddLine,
				run: () => newWorkspace(workspace.projectId),
			},
		];
		return { ...item, actions: () => actions };
	}
	return item;
}
