import {
	type RemixiconComponentType,
	RiAddLine,
	RiChatNewLine,
	RiCheckDoubleLine,
	RiContrast2Line,
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
	RiPlugLine,
	RiPuzzle2Line,
	RiSearchEyeLine,
	RiSettings3Line,
} from "@remixicon/react";
import type { ExtensionCatalogEntry, ThemeId, Workspace } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type { Command, CommandContext } from "../commands";
import { lockedSettings } from "../panels/McpSettings";
import { mcpRowView } from "../panels/mcpServerView";
import type { SettingsNavGroup } from "../panels/settingsNav";
import type { PaletteItem, PalettePage } from "../search";
import type { McpServerRow, SettingsSection } from "../store";
import type { ThemeDescriptor } from "../themes";
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
	readonly readAction: "markRead" | "markUnread" | null;
	readonly canSettle: boolean;
	readonly settled: boolean;
	readonly settingsGroups: readonly SettingsNavGroup[];
	readonly themes: readonly ThemeDescriptor[];
	readonly theme: ThemeId;
	readonly extensions: readonly ExtensionCatalogEntry[] | null;
	readonly disabledExtensions: readonly string[];
	readonly mcpRows: readonly McpServerRow[] | null;
	readonly nowMs: number;
	readonly doubleShift: boolean;
	readonly actions: PaletteCatalogActions;
}

export interface PaletteCatalogActions {
	readonly newWorkspace: (projectId: string) => void;
	readonly openProject: () => void;
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
	readonly setTheme: (theme: ThemeId) => void;
	readonly setExtensionEnabled: (name: string, enabled: boolean) => void;
	readonly setMcpEnabled: (row: McpServerRow, enabled: boolean) => void;
	readonly setDoubleShift: (enabled: boolean) => void;
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
			id: "view.theme",
			title: t("commands.view.theme"),
			group: "view",
			icon: RiContrast2Line,
			keywords: ["appearance", "dark", "light", "colors"],
			page: "theme",
		},
		{
			id: "settings.open",
			title: t("commands.settings.open"),
			group: "settings",
			icon: RiSettings3Line,
			keywords: ["preferences", "options"],
			page: "settings",
		},
		{
			id: "settings.extensions",
			title: t("commands.settings.extensions"),
			group: "settings",
			icon: RiPuzzle2Line,
			keywords: ["extension", "enable", "disable", "tools"],
			page: "extensions",
		},
		{
			id: "settings.mcp",
			title: t("commands.settings.mcp"),
			group: "settings",
			icon: RiPlugLine,
			keywords: ["mcp", "server", "tools", "enable", "disable"],
			when: hasWorkspace,
			page: "mcp",
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
			toggle: { on: deps.doubleShift, set: deps.actions.setDoubleShift },
		},
	];
}

function offlineReason(deps: PaletteCatalogDeps): Partial<PaletteItem> {
	return deps.context.online ? {} : { disabledReason: deps.t("search.palette.offlineReason") };
}

export function buildPages(deps: PaletteCatalogDeps): Record<string, PalettePage> {
	const { t, actions } = deps;
	return {
		settings: {
			id: "settings",
			crumb: [t("search.page.settings")],
			placeholder: t("search.page.settingsPlaceholder"),
			sections: () =>
				deps.settingsGroups.map((group) => ({
					title: t(group.label),
					items: settingsSectionItems(group, deps),
				})),
		},
		theme: {
			id: "theme",
			crumb: [t("search.page.theme")],
			placeholder: t("search.page.themePlaceholder"),
			sections: () => [
				{
					title: t("search.group.themes"),
					items: deps.themes.map(
						(theme): PaletteItem => ({
							id: `theme:${theme.id}`,
							kind: "theme",
							title: theme.label,
							...(theme.contrast === "high" ? { subtitle: t("search.item.highContrast") } : {}),
							group: "themes",
							scope: "commands",
							icon: RiContrast2Line,
							...(theme.id === deps.theme ? { meta: t("search.item.current") } : {}),
							...offlineReason(deps),
							run: () => actions.setTheme(theme.id),
						}),
					),
				},
			],
		},
		extensions: {
			id: "extensions",
			crumb: [t("search.page.settings"), t("search.page.extensions")],
			placeholder: t("search.page.extensionsPlaceholder"),
			sections: () => [
				{
					title:
						deps.extensions === null
							? t("search.page.extensionsLoading")
							: t("search.group.extensions"),
					items: (deps.extensions ?? []).map((entry): PaletteItem => {
						const enabled = !deps.disabledExtensions.includes(entry.name);
						return {
							id: `extension:${entry.name}`,
							kind: "extension",
							title: entry.title,
							...(entry.description ? { subtitle: entry.description } : {}),
							group: "extensions",
							scope: "commands",
							icon: RiPuzzle2Line,
							...offlineReason(deps),
							toggle: {
								on: enabled,
								set: (on) => actions.setExtensionEnabled(entry.name, on),
							},
						};
					}),
				},
			],
		},
		mcp: {
			id: "mcp",
			crumb: [t("search.page.settings"), t("search.page.mcp")],
			placeholder: t("search.page.mcpPlaceholder"),
			sections: () => [
				{
					title:
						deps.mcpRows === null ? t("search.page.mcpLoading") : t("search.page.mcpInWorkspace"),
					items: (deps.mcpRows ?? []).map((row): PaletteItem => {
						const toggleable = !lockedSettings(row);
						const enabled = row.summary.enabled;
						const subtitle = [
							t(
								row.summary.scope === "user"
									? "search.item.mcpPersonal"
									: "search.item.mcpRepository",
							),
							mcpRowView(t, row, deps.nowMs).label,
						].join(" · ");
						return {
							id: `mcp:${row.key}`,
							kind: "mcp",
							title: row.summary.name,
							subtitle,
							group: "mcp",
							scope: "commands",
							icon: RiPlugLine,
							...offlineReason(deps),
							...(toggleable
								? { toggle: { on: enabled, set: (on: boolean) => actions.setMcpEnabled(row, on) } }
								: { run: () => actions.openSettings("mcp") }),
						};
					}),
				},
				{
					title: "",
					items: [
						{
							id: "mcp:open-settings",
							kind: "setting",
							title: t("search.page.mcpManage"),
							group: "mcp",
							scope: "commands",
							icon: RiSettings3Line,
							run: () => actions.openSettings("mcp"),
						},
					],
				},
			],
		},
	};
}

export function emptyStateActionIds(): readonly string[] {
	return [
		"command:workspace.new",
		"command:project.open",
		"command:chat.history",
		"command:settings.open",
	];
}
