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
export type ExtensionStatus = "active" | "error";

export interface ExtensionInfo {
	name: string;
	title: string;
	scope: ExtensionScope;
	projectId?: string;
	status: ExtensionStatus;
	generation: number | null;
	surfaces: ExtensionSurface[];
	permissions: string[];
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
	"ui",
	"cn",
] as const;
export type ExtViewExport = (typeof EXT_VIEW_EXPORTS)[number];
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

export const EXT_WS_METHODS = {
	extList: "ext.list",
	extSnapshot: "ext.snapshot",
	extAction: "ext.action",
	extReload: "ext.reload",
	extReportError: "ext.reportError",
} as const;

export const EXT_WS_CHANNELS = {
	extChanged: "ext.changed",
	extRemoved: "ext.removed",
	extChannel: "ext.channel",
	extChannelsDropped: "ext.channelsDropped",
} as const;

export interface ExtRemovedPush {
	name: string;
}

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
}
