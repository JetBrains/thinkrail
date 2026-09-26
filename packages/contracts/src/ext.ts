import type { ExtLayoutToolId } from "./domain";
import type { ExtensionTheme, ExtThemeOverlay } from "./extTheme";

export const SURFACE_SLOTS = ["tab", "panel", "status", "toolCard", "message"] as const;
export type SurfaceSlot = (typeof SURFACE_SLOTS)[number];

export interface ExtensionSurface {
	id: string;
	slot: SurfaceSlot;
	title?: string;
	tool?: string;
	customType?: string;
}

export type ExtensionScope = "user" | "project";
export type ExtensionStatus = "active" | "error" | "blocked";

export interface ExtensionInfo {
	name: string;
	title: string;
	scope: ExtensionScope;
	projectId?: string;
	status: ExtensionStatus;
	generation: number | null;
	surfaces: ExtensionSurface[];
	permissions: string[];
	themes: ExtensionTheme[];
	build: string | null;
	error?: string;
}

export interface ExtActionContext {
	projectId?: string;
	workspaceId?: string;
	sessionId?: string;
}

export interface HostContext extends ExtActionContext {
	theme: "light" | "dark";
}

export const EXT_RUNTIME_GLOBAL = "__thinkrail_runtime__";
export const EXT_RUNTIME_MODULES = [
	"react",
	"react/jsx-runtime",
	"react/jsx-dev-runtime",
	"react-dom",
	"@thinkrail/ext/view",
] as const;
export type ExtRuntimeModule = (typeof EXT_RUNTIME_MODULES)[number];
export const EXT_VIEW_EXPORTS = [
	"useChannel",
	"useAction",
	"useHostContext",
	"openSurface",
	"startChat",
	"useTheme",
	"ui",
	"cn",
	"remixicon",
] as const;
export type ExtViewExport = (typeof EXT_VIEW_EXPORTS)[number];
export const EXT_VIEW_UI_EXPORTS = [
	"Button",
	"Input",
	"Textarea",
	"Switch",
	"Tooltip",
	"TooltipContent",
	"TooltipTrigger",
	"IconTooltip",
	"Popover",
	"PopoverAnchor",
	"PopoverContent",
	"PopoverTrigger",
	"Dialog",
	"DialogClose",
	"DialogContent",
	"DialogDescription",
	"DialogFooter",
	"DialogHeader",
	"DialogTitle",
	"DialogTrigger",
	"DropdownMenu",
	"DropdownMenuContent",
	"DropdownMenuGroup",
	"DropdownMenuItem",
	"DropdownMenuLabel",
	"DropdownMenuSeparator",
	"DropdownMenuTrigger",
	"ContextMenu",
	"ContextMenuContent",
	"ContextMenuItem",
	"ContextMenuSeparator",
	"ContextMenuTrigger",
	"Command",
	"CommandEmpty",
	"CommandGroup",
	"CommandInput",
	"CommandItem",
	"CommandList",
	"CommandSeparator",
] as const;
export type ExtViewUiExport = (typeof EXT_VIEW_UI_EXPORTS)[number];

export interface ExtToolCallView {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result: unknown;
	status: "running" | "done" | "error";
}

export interface ExtMessageView {
	customType: string;
	text: string;
	details: unknown;
	timestamp: number;
}

export interface ExtSurfaceProps {
	surfaceId: string;
	host: HostContext;
	params?: Record<string, string>;
	toolCall?: ExtToolCallView;
	message?: ExtMessageView;
}

export const EXT_NAME_PATTERN = "[a-z][a-z0-9-]*";
const EXT_NAME = new RegExp(`^${EXT_NAME_PATTERN}$`);
const EXT_TOOL_PREFIX = "ext:" as const;

export const extToolId = ({ name, surfaceId }: { name: string; surfaceId: string }) =>
	`${EXT_TOOL_PREFIX}${name}:${surfaceId}` as const;

export const extChannelKey = (name: string, key: string) => `${name}:${key}`;

export const isOwnChannelKey = (name: string, channelKey: string) =>
	channelKey.startsWith(extChannelKey(name, ""));

export const parseExtToolId = (tool: string) => {
	if (!tool.startsWith(EXT_TOOL_PREFIX)) return null;
	const [name, surfaceId, ...rest] = tool.slice(EXT_TOOL_PREFIX.length).split(":");
	if (rest.length > 0 || !name || !surfaceId || !EXT_NAME.test(name) || !EXT_NAME.test(surfaceId))
		return null;
	return { name, surfaceId };
};

export const isExtLayoutToolId = (tool: string): tool is ExtLayoutToolId =>
	parseExtToolId(tool) !== null;
export type ExtAssetKind = "js" | "css";

export const extAssetPath = ({
	name,
	build,
	surfaceId,
	kind,
}: {
	name: string;
	build: string;
	surfaceId: string;
	kind: ExtAssetKind;
}) => `/ext/${name}/${build}/${surfaceId}.${kind}`;

export const extThemeCssPath = ({
	name,
	build,
	themeId,
}: {
	name: string;
	build: string;
	themeId: string;
}) => `/ext/${name}/${build}/${themeId}.theme.css`;

export type ExtThemePreviewResult = { ok: true } | { ok: false; errors: string[] };

export interface ExtViewTheme {
	active: { name: string; id: string } | null;
	previewing: boolean;
	select: (themeId: string | null) => void;
	preview: (overlay: ExtThemeOverlay | null) => ExtThemePreviewResult;
}

export const EXT_WS_METHODS = {
	extList: "ext.list",
	extSnapshot: "ext.snapshot",
	extAction: "ext.action",
	extReload: "ext.reload",
	extReportError: "ext.reportError",
	extWatch: "ext.watch",
} as const;

export const EXT_WS_CHANNELS = {
	extChanged: "ext.changed",
	extRemoved: "ext.removed",
	extChannel: "ext.channel",
	extChannelsDropped: "ext.channelsDropped",
} as const;

export interface ExtRemovedPush {
	name: string;
	blockedProjectId?: string;
}

export const blockedExtensionKey = (projectId: string, name: string) => `${projectId}/${name}`;

export const extensionKey = ({ name, status, projectId }: ExtensionInfo) =>
	status === "blocked" && projectId !== undefined ? blockedExtensionKey(projectId, name) : name;

export const removedExtensionKey = ({ name, blockedProjectId }: ExtRemovedPush) =>
	blockedProjectId === undefined ? name : blockedExtensionKey(blockedProjectId, name);

export interface ExtChannelPush {
	key: string;
	value: unknown;
}

export interface ExtChannelsDroppedPush {
	name: string;
	keys: string[];
}

export interface ExtWsMethodMap {
	"ext.list": { params: Record<string, never>; result: ExtensionInfo[] };
	"ext.snapshot": { params: { keys?: string[] }; result: Record<string, unknown> };
	"ext.action": {
		params: { ext: string; id: string; payload?: unknown; ctx?: ExtActionContext };
		result: unknown;
	};
	"ext.reload": { params: { name: string }; result: ExtensionInfo };
	"ext.reportError": {
		params: { name: string; surfaceId: string; message: string };
		result: { ok: true };
	};
	"ext.watch": { params: { keys: string[] }; result: { ok: true } };
}
