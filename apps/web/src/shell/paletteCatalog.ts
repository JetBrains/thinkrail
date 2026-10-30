import {
	type RemixiconComponentType,
	RiAddLine,
	RiChatNewLine,
	RiCheckDoubleLine,
	RiEdit2Line,
	RiFileList3Line,
	RiFolderLine,
	RiFolderOpenLine,
	RiHistoryLine,
	RiInboxArchiveLine,
	RiInboxUnarchiveLine,
	RiKeyboardLine,
	RiLayoutBottomLine,
	RiLayoutLeftLine,
	RiLayoutRightLine,
	RiListCheck3,
	RiMailUnreadLine,
	RiNodeTree,
	RiSearchEyeLine,
	RiSettings3Line,
	RiSparkling2Line,
} from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type { Command, CommandContext } from "../commands";
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
};

const TOOL_ICONS: Record<PaletteTool, RemixiconComponentType> = {
	specs: RiNodeTree,
	files: RiFolderLine,
	review: RiFileList3Line,
	plan: RiListCheck3,
};

export interface PaletteCatalogDeps {
	readonly t: Translator;
	readonly context: CommandContext;
	readonly activeWorkspace: Workspace | null;
	readonly historyAvailable: boolean;
	readonly canCreateProject: boolean;
	readonly settingsShortcut: boolean;
	readonly readAction: "markRead" | "markUnread" | null;
	readonly canSettle: boolean;
	readonly settled: boolean;
	readonly settleBlocked: boolean;
	readonly settingsGroups: readonly SettingsNavGroup[];
	readonly actions: PaletteCatalogActions;
}

export interface PaletteCatalogActions {
	readonly newWorkspace: (projectId: string) => void;
	readonly openProject: () => void;
	readonly openProjectPath: () => void;
	readonly createProject: () => void;
	readonly newChat: (workspaceId: string) => void;
	readonly toggleLeft: () => void;
	readonly toggleRight: (workspaceId: string) => void;
	readonly toggleBottom: (workspaceId: string) => void;
	readonly showTool: (workspaceId: string, tool: PaletteTool) => void;
	readonly openHistory: () => void;
	readonly markRead: (workspaceId: string) => void;
	readonly markUnread: (workspaceId: string) => void;
	readonly settle: (workspaceId: string) => void;
	readonly unsettle: (workspaceId: string) => void;
	readonly reveal: (workspace: Workspace) => void;
	readonly openSettings: (section?: SettingsSection) => void;
}

const hasWorkspace = (context: CommandContext) => context.workspaceId !== null;

export function buildCommands(deps: PaletteCatalogDeps): Command[] {
	const { t, actions, activeWorkspace } = deps;
	const workspaceId = activeWorkspace?.id ?? null;
	const commands: Command[] = [
		{
			id: "workspace.new",
			title: t("commands.workspace.new"),
			group: "work",
			icon: RiAddLine,
			keywords: ["create", "start", "task", "worktree"],
			shortcut: { key: "N", mod: true },
			when: (context) => context.projectId !== null,
			run: (context) => {
				if (context.projectId) actions.newWorkspace(context.projectId);
			},
		},
		{
			id: "chat.new",
			title: t("commands.chat.new"),
			group: "work",
			icon: RiChatNewLine,
			keywords: ["session", "agent"],
			mutates: true,
			when: hasWorkspace,
			run: (context) => {
				if (context.workspaceId) actions.newChat(context.workspaceId);
			},
		},
		{
			id: "project.open",
			title: t("commands.project.open"),
			group: "work",
			icon: RiFolderOpenLine,
			keywords: ["add", "repository", "folder"],
			mutates: true,
			run: () => actions.openProject(),
		},
		{
			id: "project.openPath",
			title: t("commands.project.openPath"),
			group: "work",
			icon: RiEdit2Line,
			keywords: ["add", "path", "folder", "remote", "host"],
			mutates: true,
			run: () => actions.openProjectPath(),
		},
		...(deps.canCreateProject
			? [
					{
						id: "project.create",
						title: t("commands.project.create"),
						group: "work" as const,
						icon: RiSparkling2Line,
						keywords: ["new", "create", "repository", "init"],
						mutates: true,
						run: () => actions.createProject(),
					},
				]
			: []),
		{
			id: "chat.history",
			title: t("commands.chat.history"),
			group: "navigation",
			icon: RiHistoryLine,
			keywords: ["recall", "prompt", "transcript"],
			shortcut: { key: "R", ctrl: true },
			when: () => deps.historyAvailable,
			run: () => actions.openHistory(),
		},
		...(Object.keys(TOOL_LABELS) as PaletteTool[]).map(
			(tool): Command => ({
				id: `view.show.${tool}`,
				title: t("commands.view.showTool", { tool: t(TOOL_LABELS[tool]) }),
				group: "view",
				icon: TOOL_ICONS[tool],
				keywords: ["panel", "tool", tool],
				when: hasWorkspace,
				run: (context) => {
					if (context.workspaceId) actions.showTool(context.workspaceId, tool);
				},
			}),
		),
		{
			id: "view.toggleLeft",
			title: t("commands.view.toggleLeft"),
			group: "view",
			icon: RiLayoutLeftLine,
			keywords: ["sidebar", "left", "hide", "show"],
			shortcut: { key: "B", mod: true },
			run: () => actions.toggleLeft(),
		},
		{
			id: "view.toggleRight",
			title: t("commands.view.toggleRight"),
			group: "view",
			icon: RiLayoutRightLine,
			keywords: ["sidebar", "right", "hide", "show"],
			shortcut: { key: "J", mod: true },
			when: hasWorkspace,
			run: (context) => {
				if (context.workspaceId) actions.toggleRight(context.workspaceId);
			},
		},
		{
			id: "view.toggleBottom",
			title: t("commands.view.toggleBottom"),
			group: "view",
			icon: RiLayoutBottomLine,
			keywords: ["terminal", "bottom", "hide", "show"],
			shortcut: { key: "J", mod: true, shift: true },
			when: hasWorkspace,
			run: (context) => {
				if (context.workspaceId) actions.toggleBottom(context.workspaceId);
			},
		},
		{
			id: "settings.open",
			title: t("commands.settings.open"),
			group: "settings",
			icon: RiSettings3Line,
			keywords: ["preferences", "options"],
			...(deps.settingsShortcut ? { shortcut: { key: ",", mod: true } } : {}),
			run: () => actions.openSettings(),
		},
	];
	if (workspaceId && deps.readAction === "markRead") {
		commands.push({
			id: "workspace.markRead",
			title: t("commands.workspace.markRead"),
			group: "workspace",
			icon: RiCheckDoubleLine,
			mutates: true,
			run: () => actions.markRead(workspaceId),
		});
	}
	if (workspaceId && deps.readAction === "markUnread") {
		commands.push({
			id: "workspace.markUnread",
			title: t("commands.workspace.markUnread"),
			group: "workspace",
			icon: RiMailUnreadLine,
			mutates: true,
			run: () => actions.markUnread(workspaceId),
		});
	}
	if (workspaceId && deps.canSettle) {
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
	if (activeWorkspace) {
		commands.push({
			id: "workspace.reveal",
			title: t("commands.workspace.reveal"),
			group: "workspace",
			icon: RiSearchEyeLine,
			keywords: ["finder", "explorer", "files", "folder"],
			mutates: true,
			run: () => actions.reveal(activeWorkspace),
		});
	}
	return commands;
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
