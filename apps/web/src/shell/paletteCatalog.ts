import {
	type RemixiconComponentType,
	RiAddLine,
	RiArrowLeftLine,
	RiArrowRightLine,
	RiChat3Line,
	RiChatNewLine,
	RiCheckDoubleLine,
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
	RiLayoutLeftLine,
	RiLayoutRightLine,
	RiListCheck3,
	RiMailUnreadLine,
	RiNodeTree,
	RiResetLeftLine,
	RiSearchEyeLine,
	RiSettings3Line,
	RiShapesLine,
	RiSparkling2Line,
	RiTerminalBoxLine,
	RiZoomInLine,
	RiZoomOutLine,
} from "@remixicon/react";
import type { EditorInfo, NativePageZoomBridge, Workspace } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type { Command } from "../commands";
import { FOCUS_GROUP_BINDINGS, type KeybindingId, keybindingShortcut } from "../keybindings";
import type { SettingsNavGroup } from "../panels/settingsNav";
import type { PaletteItem } from "../search";
import type { SettingsSection } from "../store";
import type { LayoutToolId } from "./layout";

export type PaletteTool = Exclude<LayoutToolId, "projects">;

const TOOL_LABELS: Record<PaletteTool, MessageKey> = {
	specs: "workbench.tool.specs",
	files: "workbench.tool.files",
	review: "workbench.tool.review",
	plan: "workbench.tool.plan",
	artifacts: "workbench.tool.artifacts",
};

const TOOL_ICONS: Record<PaletteTool, RemixiconComponentType> = {
	specs: RiNodeTree,
	files: RiFolderLine,
	review: RiFileList3Line,
	plan: RiListCheck3,
	artifacts: RiShapesLine,
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
	readonly pageZoom: NativePageZoomBridge | null;
	readonly findInFilesAvailable: boolean;
	readonly changesAvailable: boolean;
	readonly centerGroupCount: number;
	readonly readAction: "markRead" | "markUnread" | null;
	readonly canSettle: boolean;
	readonly settled: boolean;
	readonly settleBlocked: boolean;
	readonly settingsGroups: readonly SettingsNavGroup[];
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
	readonly openSettings: (section?: SettingsSection) => void;
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
			shortcut: keybindingShortcut("workspace.new", { browser: !deps.nativeShortcuts }),
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
			shortcut: keybindingShortcut("region.next"),
			run: () => actions.focusRegion(1),
		},
		{
			id: "region.previous",
			title: t("commands.focus.previousRegion"),
			group: "navigation",
			icon: RiArrowLeftLine,
			keywords: ["region", "pane", "panel", "cycle"],
			shortcut: keybindingShortcut("region.previous"),
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
			shortcut: keybindingShortcut("focus.composer"),
			run: actions.focusComposer,
		});
	}
	commands.push({
		id: "focus.projects",
		title: t("commands.focus.projects"),
		group: "navigation",
		icon: RiFolder2Line,
		keywords: ["sidebar", "projects", "workspaces"],
		shortcut: keybindingShortcut("focus.projects"),
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
			shortcut: keybindingShortcut("focus.terminal"),
			run: actions.focusTerminal,
		},
		...FOCUS_GROUP_BINDINGS.slice(0, deps.centerGroupCount).map(
			(binding, index): Command => ({
				id: binding,
				title: t("commands.focus.group", { position: index + 1 }),
				group: "navigation",
				icon: RiLayoutColumnLine,
				keywords: ["group", "editor", "split"],
				shortcut: keybindingShortcut(binding),
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
			shortcut: { key: "=", mod: true },
			run: () => pageZoom.request("in"),
		},
		{
			id: "view.zoomOut",
			title: t("commands.view.zoomOut"),
			group: "view",
			icon: RiZoomOutLine,
			keywords: ["zoom", "smaller", "scale"],
			shortcut: { key: "-", mod: true },
			run: () => pageZoom.request("out"),
		},
		{
			id: "view.zoomReset",
			title: t("commands.view.zoomReset"),
			group: "view",
			icon: RiResetLeftLine,
			keywords: ["zoom", "actual size", "100%", "scale"],
			shortcut: { key: "Num 0", mod: true },
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
			shortcut: keybindingShortcut("files.findInFiles"),
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
			shortcut: keybindingShortcut("chat.history"),
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
					? { shortcut: keybindingShortcut("view.files"), run: () => actions.showFiles("all") }
					: { run: () => actions.showTool(activeWorkspace.id, tool) }),
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
			shortcut: keybindingShortcut("view.changes"),
			run: () => actions.showFiles("changed"),
		});
	}
	commands.push({
		id: "view.toggleLeft",
		title: t("commands.view.toggleLeft"),
		group: "view",
		icon: RiLayoutLeftLine,
		keywords: ["sidebar", "left", "hide", "show"],
		shortcut: keybindingShortcut("view.toggleLeft"),
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
				shortcut: keybindingShortcut("view.toggleRight"),
				run: actions.toggleRight,
			},
			{
				id: "view.toggleBottom",
				title: t("commands.view.toggleBottom"),
				group: "view",
				icon: RiLayoutBottomLine,
				keywords: ["terminal", "bottom", "hide", "show"],
				shortcut: keybindingShortcut("view.toggleBottom"),
				run: actions.toggleBottom,
			},
		);
	}
	commands.push(...pageZoomCommands(deps), {
		id: "settings.open",
		title: t("commands.settings.open"),
		group: "settings",
		icon: RiSettings3Line,
		keywords: ["preferences", "options"],
		...(deps.nativeShortcuts ? { shortcut: { key: ",", mod: true } } : {}),
		run: () => actions.openSettings(),
	});
	return commands;
}

function workspaceCommands(deps: PaletteCatalogDeps): Command[] {
	const { t, actions, activeWorkspace } = deps;
	if (!activeWorkspace) return [];
	const workspaceId = activeWorkspace.id;
	const commands: Command[] = [];
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

export function buildCommands(deps: PaletteCatalogDeps): Command[] {
	return [...workCommands(deps), ...viewCommands(deps), ...workspaceCommands(deps)];
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

export function buildSettingsItems(deps: PaletteCatalogDeps): PaletteItem[] {
	const { t } = deps;
	return [
		...deps.settingsGroups.flatMap((group) => settingsSectionItems(group, deps)),
		{
			id: "setting:double-shift",
			kind: "setting",
			title: t("settings.keyboard.doubleShift"),
			subtitle: t("search.item.settingsPath", { group: t("settings.nav.keyboard") }),
			group: "settings",
			scope: "commands",
			icon: RiKeyboardLine,
			keywords: ["shortcut", "hotkey", "shift"],
			run: () => deps.actions.openSettings("keyboard"),
		},
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
