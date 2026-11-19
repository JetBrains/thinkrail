import {
	type RemixiconComponentType,
	RiAddBoxLine,
	RiAddLine,
	RiArrowLeftLine,
	RiArrowRightLine,
	RiChat3Line,
	RiChatNewLine,
	RiCheckDoubleLine,
	RiCloseLine,
	RiDeleteBinLine,
	RiDragMove2Line,
	RiEdit2Line,
	RiExternalLinkLine,
	RiFileCopyLine,
	RiFileEditLine,
	RiFileList3Line,
	RiFileSearchLine,
	RiFolder2Line,
	RiFolderLine,
	RiFolderOpenLine,
	RiHistoryLine,
	RiHome4Line,
	RiInboxArchiveLine,
	RiInboxUnarchiveLine,
	RiInputCursorMove,
	RiKeyboardLine,
	RiLayoutBottomLine,
	RiLayoutColumnLine,
	RiLayoutGridLine,
	RiLayoutLeftLine,
	RiLayoutRightLine,
	RiListCheck3,
	RiMailUnreadLine,
	RiNodeTree,
	RiPushpinLine,
	RiResetLeftLine,
	RiSearchEyeLine,
	RiSettings3Line,
	RiShapesLine,
	RiSparkling2Line,
	RiStackLine,
	RiTerminalBoxLine,
	RiZoomInLine,
	RiZoomOutLine,
} from "@remixicon/react";
import type { EditorInfo, NativePageZoomBridge, Workspace } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type { Command, CommandShortcut } from "../commands";
import type { RegisteredPanel } from "../extensions";
import {
	DESKTOP_KEYS,
	FOCUS_GROUP_BINDINGS,
	KEYBINDINGS,
	type KeybindingId,
	keybindingShortcut,
	type ResolvedKeybindings,
} from "../keybindings";
import type { SettingEntry } from "../panels/settingsCatalog";
import type { SettingsNavGroup } from "../panels/settingsNav";
import type { PaletteItem } from "../search";
import type { ContainerDialogRequest, SettingsSection } from "../store";
import type { LayoutToolId, TabAction } from "./layout";

export type PaletteTool = Exclude<LayoutToolId, "projects">;

const TOOL_LABELS: Record<PaletteTool, MessageKey> = {
	specs: "workbench.tool.specs",
	files: "workbench.tool.files",
	review: "workbench.tool.review",
	plan: "workbench.tool.plan",
	artifacts: "workbench.tool.artifacts",
	orchestrator: "workbench.tool.orchestrator",
};

const TOOL_ICONS: Record<PaletteTool, RemixiconComponentType> = {
	specs: RiNodeTree,
	files: RiFolderLine,
	review: RiFileList3Line,
	plan: RiListCheck3,
	artifacts: RiShapesLine,
	orchestrator: RiSparkling2Line,
};

export interface PaletteCatalogDeps {
	readonly t: Translator;
	readonly contextProjectId: string | null;
	readonly canStartChat: boolean;
	readonly activeWorkspace: Workspace | null;
	readonly editors: readonly EditorInfo[];
	readonly historyAvailable: boolean;
	readonly canCreateProject: boolean;
	readonly nativeShortcuts: boolean;
	readonly keybindings: ResolvedKeybindings;
	readonly pageZoom: NativePageZoomBridge | null;
	readonly findInFilesAvailable: boolean;
	readonly changesAvailable: boolean;
	readonly centerGroupCount: number;
	readonly readAction: "markRead" | "markUnread" | null;
	readonly canSettle: boolean;
	readonly settled: boolean;
	readonly settleBlocked: boolean;
	/** The container the active workspace belongs to (as a member or its orchestrator). */
	readonly containerId: string | null;
	/** The active workspace may be grouped into a new container. */
	readonly canGroup: boolean;
	readonly settingsGroups: readonly SettingsNavGroup[];
	readonly settingEntries: readonly SettingEntry[];
	readonly tabActions: readonly TabAction[];
	readonly extensionPanels: readonly RegisteredPanel[];
	readonly actions: PaletteCatalogActions;
}

export interface PaletteCatalogActions {
	readonly newWorkspace: (projectId: string) => void;
	readonly newProjectlessChat: () => void;
	readonly openDefaultWorkspace: (projectId: string) => void;
	readonly openProject: () => void;
	readonly openProjectPath: () => void;
	readonly createProject: () => void;
	readonly newChat: (workspaceId: string) => void;
	readonly newTerminal: (workspaceId: string) => void;
	readonly toggleLeft: () => void;
	readonly toggleRight: () => void;
	readonly toggleBottom: () => void;
	readonly showTool: (workspaceId: string, tool: PaletteTool) => void;
	readonly openExtensionPanel: (workspaceId: string, panel: RegisteredPanel) => void;
	readonly openExtensionPanelInProject: (projectId: string, panel: RegisteredPanel) => void;
	readonly showFiles: (mode: "all" | "changed") => void;
	readonly focusRegion: (delta: 1 | -1) => void;
	readonly focusComposer: () => void;
	readonly focusProjects: () => void;
	readonly focusTerminal: () => void;
	readonly focusGroup: (binding: KeybindingId) => void;
	readonly openHistory: () => void;
	readonly findInFiles: () => void;
	readonly markRead: (workspaceId: string) => void;
	readonly markUnread: (workspaceId: string) => void;
	readonly settle: (workspaceId: string) => void;
	readonly unsettle: (workspaceId: string) => void;
	readonly reveal: (workspace: Workspace) => void;
	readonly copyPath: (workspace: Workspace) => void;
	readonly openIn: (workspace: Workspace, editor: EditorInfo) => void;
	readonly openSettings: (section?: SettingsSection, settingId?: string) => void;
	readonly openShortcuts: () => void;
	readonly runTabAction: (actionId: string) => void;
	readonly openContainerDialog: (request: ContainerDialogRequest) => void;
	readonly openContainerOverview: (containerId: string) => void;
}

function shortcutOf(
	{ keybindings, nativeShortcuts }: PaletteCatalogDeps,
	id: string,
): { shortcut?: CommandShortcut } {
	const shortcut = keybindingShortcut(keybindings, id, { browser: !nativeShortcuts });
	return shortcut ? { shortcut } : {};
}

function workCommands(deps: PaletteCatalogDeps): Command[] {
	const { t, actions, activeWorkspace, contextProjectId } = deps;
	const commands: Command[] = [];
	if (contextProjectId !== null) {
		commands.push({
			id: "workspace.new",
			title: t("commands.workspace.new"),
			group: "work",
			icon: RiAddLine,
			keywords: ["create", "start", "task", "worktree"],
			...shortcutOf(deps, "workspace.new"),
			run: () => actions.newWorkspace(contextProjectId),
		});
	}
	if (activeWorkspace) {
		commands.push({
			id: "chat.new",
			title: t("commands.chat.new"),
			group: "work",
			icon: RiChatNewLine,
			keywords: ["session", "agent"],
			mutates: true,
			run: () => actions.newChat(activeWorkspace.id),
		});
	}
	if (deps.canStartChat) {
		commands.push({
			id: "chat.newProjectless",
			title: t("commands.chat.newProjectless"),
			group: "work",
			icon: RiChat3Line,
			keywords: ["chat", "no project", "scratch", "quick"],
			mutates: true,
			run: actions.newProjectlessChat,
		});
	}
	commands.push(
		{
			id: "project.open",
			title: t("commands.project.open"),
			group: "work",
			icon: RiFolderOpenLine,
			keywords: ["add", "repository", "folder"],
			mutates: true,
			run: actions.openProject,
		},
		{
			id: "project.openPath",
			title: t("commands.project.openPath"),
			group: "work",
			icon: RiEdit2Line,
			keywords: ["add", "path", "folder", "remote", "host"],
			mutates: true,
			run: actions.openProjectPath,
		},
	);
	if (deps.canCreateProject) {
		commands.push({
			id: "project.create",
			title: t("commands.project.create"),
			group: "work",
			icon: RiSparkling2Line,
			keywords: ["new", "create", "repository", "init"],
			mutates: true,
			run: actions.createProject,
		});
	}
	if (contextProjectId !== null) {
		commands.push({
			id: "workspace.openDefault",
			title: t("commands.workspace.openDefault"),
			group: "work",
			icon: RiHome4Line,
			keywords: ["default", "project folder", "no worktree"],
			mutates: true,
			run: () => actions.openDefaultWorkspace(contextProjectId),
		});
	}
	if (activeWorkspace) {
		commands.push({
			id: "terminal.new",
			title: t("commands.terminal.new"),
			group: "work",
			icon: RiTerminalBoxLine,
			keywords: ["shell", "console"],
			mutates: true,
			run: () => actions.newTerminal(activeWorkspace.id),
		});
	}
	return commands;
}

function focusCommands(deps: PaletteCatalogDeps): Command[] {
	const { t, actions, activeWorkspace } = deps;
	const commands: Command[] = [
		{
			id: "region.next",
			title: t("commands.focus.nextRegion"),
			group: "navigation",
			icon: RiArrowRightLine,
			keywords: ["region", "pane", "panel", "cycle"],
			...shortcutOf(deps, "region.next"),
			run: () => actions.focusRegion(1),
		},
		{
			id: "region.previous",
			title: t("commands.focus.previousRegion"),
			group: "navigation",
			icon: RiArrowLeftLine,
			keywords: ["region", "pane", "panel", "cycle"],
			...shortcutOf(deps, "region.previous"),
			run: () => actions.focusRegion(-1),
		},
	];
	if (deps.historyAvailable) {
		commands.push({
			id: "focus.composer",
			title: t("commands.focus.composer"),
			group: "navigation",
			icon: RiInputCursorMove,
			keywords: ["chat", "input", "prompt", "message"],
			...shortcutOf(deps, "focus.composer"),
			run: actions.focusComposer,
		});
	}
	commands.push({
		id: "focus.projects",
		title: t("commands.focus.projects"),
		group: "navigation",
		icon: RiFolder2Line,
		keywords: ["sidebar", "projects", "workspaces"],
		...shortcutOf(deps, "focus.projects"),
		run: actions.focusProjects,
	});
	if (!activeWorkspace) return commands;
	commands.push(
		{
			id: "focus.terminal",
			title: t("commands.focus.terminal"),
			group: "navigation",
			icon: RiTerminalBoxLine,
			keywords: ["shell", "console"],
			...shortcutOf(deps, "focus.terminal"),
			run: actions.focusTerminal,
		},
		...FOCUS_GROUP_BINDINGS.slice(0, deps.centerGroupCount).map(
			(binding, index): Command => ({
				id: binding,
				title: t("commands.focus.group", { position: index + 1 }),
				group: "navigation",
				icon: RiLayoutColumnLine,
				keywords: ["group", "editor", "split"],
				...shortcutOf(deps, binding),
				run: () => actions.focusGroup(binding),
			}),
		),
	);
	return commands;
}

function pageZoomCommands({ t, pageZoom }: PaletteCatalogDeps): Command[] {
	if (!pageZoom) return [];
	return [
		{
			id: "view.zoomIn",
			title: t("commands.view.zoomIn"),
			group: "view",
			icon: RiZoomInLine,
			keywords: ["zoom", "bigger", "larger", "scale"],
			shortcut: DESKTOP_KEYS.zoomIn,
			run: () => pageZoom.request("in"),
		},
		{
			id: "view.zoomOut",
			title: t("commands.view.zoomOut"),
			group: "view",
			icon: RiZoomOutLine,
			keywords: ["zoom", "smaller", "scale"],
			shortcut: DESKTOP_KEYS.zoomOut,
			run: () => pageZoom.request("out"),
		},
		{
			id: "view.zoomReset",
			title: t("commands.view.zoomReset"),
			group: "view",
			icon: RiResetLeftLine,
			keywords: ["zoom", "actual size", "100%", "scale"],
			shortcut: DESKTOP_KEYS.zoomReset,
			run: () => pageZoom.request("reset"),
		},
	];
}

function viewCommands(deps: PaletteCatalogDeps): Command[] {
	const { t, actions, activeWorkspace } = deps;
	const commands: Command[] = [];
	if (deps.findInFilesAvailable) {
		commands.push({
			id: "files.findInFiles",
			title: t("commands.files.findInFiles"),
			group: "navigation",
			icon: RiFileSearchLine,
			keywords: ["grep", "text", "content", "occurrences"],
			...shortcutOf(deps, "files.findInFiles"),
			run: actions.findInFiles,
		});
	}
	if (deps.historyAvailable) {
		commands.push({
			id: "chat.history",
			title: t("commands.chat.history"),
			group: "navigation",
			icon: RiHistoryLine,
			keywords: ["recall", "prompt", "transcript"],
			...shortcutOf(deps, "chat.history"),
			run: actions.openHistory,
		});
	}
	commands.push(...focusCommands(deps));
	if (activeWorkspace) {
		for (const tool of Object.keys(TOOL_LABELS) as PaletteTool[]) {
			commands.push({
				id: `view.show.${tool}`,
				title: t("commands.view.showTool", { tool: t(TOOL_LABELS[tool]) }),
				group: "view",
				icon: TOOL_ICONS[tool],
				keywords: ["panel", "tool", tool],
				...(tool === "files"
					? { ...shortcutOf(deps, "view.files"), run: () => actions.showFiles("all") }
					: { run: () => actions.showTool(activeWorkspace.id, tool) }),
			});
		}
	}
	const { contextProjectId } = deps;
	const openPanel = activeWorkspace
		? (panel: RegisteredPanel) => actions.openExtensionPanel(activeWorkspace.id, panel)
		: contextProjectId !== null
			? (panel: RegisteredPanel) => actions.openExtensionPanelInProject(contextProjectId, panel)
			: null;
	if (openPanel) {
		for (const panel of deps.extensionPanels) {
			const { declaration } = panel;
			if (!declaration.scopes.includes("project")) continue;
			commands.push({
				id: `view.extension.${panel.extension}.${panel.panel}`,
				title: t("commands.view.openPanel", { panel: t(declaration.title) }),
				group: "view",
				icon: declaration.icon,
				keywords: [
					"panel",
					"extension",
					panel.extension,
					panel.panel,
					...(declaration.keywords ? [t(declaration.keywords)] : []),
				],
				...(declaration.rail?.command ? shortcutOf(deps, declaration.rail.command) : {}),
				run: () => openPanel(panel),
			});
		}
	}
	if (deps.changesAvailable) {
		commands.push({
			id: "view.changes",
			title: t("commands.view.showChanges"),
			group: "view",
			icon: RiFileEditLine,
			keywords: ["files", "changed", "git", "source control", "diff"],
			...shortcutOf(deps, "view.changes"),
			run: () => actions.showFiles("changed"),
		});
	}
	commands.push({
		id: "view.toggleLeft",
		title: t("commands.view.toggleLeft"),
		group: "view",
		icon: RiLayoutLeftLine,
		keywords: ["sidebar", "left", "hide", "show"],
		...shortcutOf(deps, "view.toggleLeft"),
		run: actions.toggleLeft,
	});
	if (activeWorkspace) {
		commands.push(
			{
				id: "view.toggleRight",
				title: t("commands.view.toggleRight"),
				group: "view",
				icon: RiLayoutRightLine,
				keywords: ["sidebar", "right", "hide", "show"],
				...shortcutOf(deps, "view.toggleRight"),
				run: actions.toggleRight,
			},
			{
				id: "view.toggleBottom",
				title: t("commands.view.toggleBottom"),
				group: "view",
				icon: RiLayoutBottomLine,
				keywords: ["terminal", "bottom", "hide", "show"],
				...shortcutOf(deps, "view.toggleBottom"),
				run: actions.toggleBottom,
			},
		);
	}
	commands.push(
		...pageZoomCommands(deps),
		{
			id: "settings.open",
			title: t("commands.settings.open"),
			group: "settings",
			icon: RiSettings3Line,
			keywords: ["preferences", "options"],
			...(deps.nativeShortcuts ? { shortcut: DESKTOP_KEYS.settings } : {}),
			run: () => actions.openSettings(),
		},
		{
			id: "shortcuts.open",
			title: t("commands.shortcuts.open"),
			group: "settings",
			icon: RiKeyboardLine,
			keywords: ["keyboard", "hotkeys", "keybindings", "cheatsheet", "help"],
			...shortcutOf(deps, "shortcuts.open"),
			run: actions.openShortcuts,
		},
	);
	return commands;
}

function containerCommands(deps: PaletteCatalogDeps, workspaceId: string): Command[] {
	const { t, actions, containerId } = deps;
	if (containerId === null) {
		return deps.canGroup
			? [
					{
						id: "container.group",
						title: t("containers.commands.group"),
						group: "workspace",
						icon: RiStackLine,
						keywords: ["container", "group", "orchestrator", "stack"],
						mutates: true,
						run: () => actions.openContainerDialog({ kind: "group", workspaceId }),
					},
				]
			: [];
	}
	return [
		{
			id: "container.overview",
			title: t("containers.commands.overview"),
			group: "workspace",
			icon: RiLayoutGridLine,
			keywords: ["container", "overview", "stack", "members"],
			run: () => actions.openContainerOverview(containerId),
		},
		{
			id: "container.addWorkspace",
			title: t("containers.commands.addWorkspace"),
			group: "workspace",
			icon: RiStackLine,
			keywords: ["container", "worktree", "stack", "attach"],
			mutates: true,
			run: () => actions.openContainerDialog({ kind: "addWorkspace", containerId }),
		},
		{
			id: "container.remove",
			title: t("containers.commands.remove"),
			group: "workspace",
			icon: RiDeleteBinLine,
			keywords: ["container", "dissolve", "archive"],
			mutates: true,
			run: () => actions.openContainerDialog({ kind: "remove", containerId }),
		},
	];
}

function workspaceCommands(deps: PaletteCatalogDeps): Command[] {
	const { t, actions, activeWorkspace } = deps;
	if (!activeWorkspace) return [];
	const workspaceId = activeWorkspace.id;
	const commands: Command[] = [...containerCommands(deps, workspaceId)];
	if (deps.readAction === "markRead") {
		commands.push({
			id: "workspace.markRead",
			title: t("commands.workspace.markRead"),
			group: "workspace",
			icon: RiCheckDoubleLine,
			mutates: true,
			run: () => actions.markRead(workspaceId),
		});
	}
	if (deps.readAction === "markUnread") {
		commands.push({
			id: "workspace.markUnread",
			title: t("commands.workspace.markUnread"),
			group: "workspace",
			icon: RiMailUnreadLine,
			mutates: true,
			run: () => actions.markUnread(workspaceId),
		});
	}
	if (deps.canSettle) {
		commands.push(
			deps.settled
				? {
						id: "workspace.unsettle",
						title: t("commands.workspace.unsettle"),
						group: "workspace",
						icon: RiInboxUnarchiveLine,
						keywords: ["unsettle", "shelf", "active"],
						mutates: true,
						run: () => actions.unsettle(workspaceId),
					}
				: {
						id: "workspace.settle",
						title: t("commands.workspace.settle"),
						group: "workspace",
						icon: RiInboxArchiveLine,
						keywords: ["shelf", "archive", "park"],
						mutates: true,
						...(deps.settleBlocked
							? { disabledReason: t("commands.workspace.settleBlocked") }
							: {}),
						run: () => actions.settle(workspaceId),
					},
		);
	}
	commands.push(
		{
			id: "workspace.reveal",
			title: t("commands.workspace.reveal"),
			group: "workspace",
			icon: RiSearchEyeLine,
			keywords: ["finder", "explorer", "files", "folder"],
			mutates: true,
			run: () => actions.reveal(activeWorkspace),
		},
		{
			id: "workspace.copyPath",
			title: t("commands.workspace.copyPath"),
			group: "workspace",
			icon: RiFileCopyLine,
			keywords: ["folder", "directory", "worktree"],
			run: () => actions.copyPath(activeWorkspace),
		},
		...deps.editors.map(
			(editor): Command => ({
				id: `workspace.openIn.${editor.id}`,
				title: t("commands.workspace.openIn", { editor: editor.label }),
				group: "workspace",
				icon: RiExternalLinkLine,
				keywords: ["editor", "ide", editor.label],
				mutates: true,
				run: () => actions.openIn(activeWorkspace, editor),
			}),
		),
	);
	return commands;
}

const TAB_SECTION_ICONS = {
	tab: RiPushpinLine,
	copy: RiFileCopyLine,
	split: RiLayoutColumnLine,
	move: RiDragMove2Line,
	newGroup: RiAddBoxLine,
	regionGroup: RiAddBoxLine,
	tools: RiLayoutRightLine,
	group: RiDeleteBinLine,
} as const satisfies Record<TabAction["section"], RemixiconComponentType>;

const HIDE_ICONS = {
	left: RiLayoutLeftLine,
	right: RiLayoutRightLine,
	bottom: RiLayoutBottomLine,
} as const;

function tabActionIcon({ effect, section }: TabAction): RemixiconComponentType {
	switch (effect.kind) {
		case "close":
			return RiCloseLine;
		case "rename":
			return RiEdit2Line;
		case "focusGroup":
			return effect.delta < 0 ? RiArrowLeftLine : RiArrowRightLine;
		case "hide":
			return HIDE_ICONS[effect.region];
		default:
			return TAB_SECTION_ICONS[section];
	}
}

function isKeybindingId(id: string): id is KeybindingId {
	return Object.hasOwn(KEYBINDINGS, id);
}

function tabCommands(deps: PaletteCatalogDeps): Command[] {
	const { t, tabActions, actions } = deps;
	return tabActions
		.filter((action) => action.surface !== "menu" && action.unavailable === undefined)
		.map(
			(action): Command => ({
				id: action.id,
				title: action.id === "tab.close" ? t("commands.tab.close") : action.label,
				group: "tab",
				icon: tabActionIcon(action),
				keywords: ["tab", "editor", "group", "pane"],
				...(isKeybindingId(action.id) ? shortcutOf(deps, action.id) : {}),
				run: () => actions.runTabAction(action.id),
			}),
		);
}

export function buildCommands(deps: PaletteCatalogDeps): Command[] {
	return [
		...workCommands(deps),
		...viewCommands(deps),
		...workspaceCommands(deps),
		...tabCommands(deps),
	];
}

function settingsSectionItems(group: SettingsNavGroup, deps: PaletteCatalogDeps): PaletteItem[] {
	const { t } = deps;
	return group.sections.map(
		(section): PaletteItem => ({
			id: `setting:${section.id}`,
			kind: "setting",
			title: t(section.label),
			subtitle: t("search.item.settingsPath", { group: t(group.label) }),
			group: "settings",
			scope: "commands",
			icon: section.icon,
			keywords: ["settings", "preferences"],
			run: () => deps.actions.openSettings(section.id),
		}),
	);
}

function settingEntryItems(deps: PaletteCatalogDeps): PaletteItem[] {
	const { t } = deps;
	const sections = new Map(
		deps.settingsGroups.flatMap((group) => group.sections.map((section) => [section.id, section])),
	);
	return deps.settingEntries.map((entry): PaletteItem => {
		const section = sections.get(entry.section);
		return {
			id: `setting:${entry.id}`,
			kind: "setting",
			title: t(entry.label),
			subtitle: t("search.item.settingsPath", {
				group: section ? t(section.label) : t("settings.dialog.feedbackCta"),
			}),
			group: "settings",
			scope: "commands",
			icon: section?.icon ?? RiSettings3Line,
			keywords: ["settings", ...(entry.keywords ?? [])],
			run: () => deps.actions.openSettings(entry.section, entry.id),
		};
	});
}

export function buildSettingsItems(deps: PaletteCatalogDeps): PaletteItem[] {
	return [
		...deps.settingsGroups.flatMap((group) => settingsSectionItems(group, deps)),
		...settingEntryItems(deps),
	];
}

export function emptyStateActionIds(): readonly string[] {
	return [
		"command:workspace.new",
		"command:project.open",
		"command:chat.history",
		"command:settings.open",
	];
}
