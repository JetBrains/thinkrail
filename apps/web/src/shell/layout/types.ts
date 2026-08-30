import type { GitDiffScope, LayoutPreset } from "@thinkrail/contracts";

export type LayoutBottomAlignment = LayoutPreset["bottom"]["alignment"];
export type LayoutToolId = LayoutPreset["left"]["groups"][number]["tools"][number];

export interface LayoutFileTab {
	kind: "file";
	id: string;
	name: string;
	path: string;
}

export interface LayoutDiffTab {
	kind: "diff";
	id: string;
	name: string;
	path: string;
	scope: GitDiffScope;
}

export interface LayoutChatTab {
	kind: "chat";
	id: string;
	name: string;
	sessionId: string;
}

export interface LayoutDocumentTab {
	kind: "document";
	id: string;
	name: string;
	documentKind: "todo-plan";
	sourceId: string;
	docPath: string;
}

export interface LayoutTerminalTab {
	kind: "terminal";
	id: string;
	name: string;
	tabKey: string;
}

export interface LayoutToolTab {
	kind: "tool";
	id: string;
	name: string;
	tool: LayoutToolId;
}

export type LayoutCenterTab =
	| LayoutFileTab
	| LayoutDiffTab
	| LayoutChatTab
	| LayoutDocumentTab
	| LayoutTerminalTab;
export type LayoutAuxiliaryTab = LayoutToolTab | LayoutTerminalTab;
export type LayoutSideTab = LayoutAuxiliaryTab;
export type LayoutTab = LayoutCenterTab | LayoutAuxiliaryTab;

export interface LayoutCenterGroup {
	kind: "group";
	id: string;
	tabs: LayoutCenterTab[];
	previewTabId?: string;
}

export interface LayoutCenterSplit {
	kind: "split";
	id: string;
	direction: "horizontal" | "vertical";
	weights: [number, number];
	children: [LayoutCenterNode, LayoutCenterNode];
}

export type LayoutCenterNode = LayoutCenterGroup | LayoutCenterSplit;

export interface LayoutSideGroup {
	id: string;
	weight: number;
	folded: boolean;
	tabs: LayoutAuxiliaryTab[];
}

export interface LayoutSideRegion {
	visible: boolean;
	width: number;
	groups: LayoutSideGroup[];
}

export interface LayoutBottomGroup {
	id: string;
	weight: number;
	folded: boolean;
	tabs: LayoutAuxiliaryTab[];
}

export interface LayoutBottomRegion {
	visible: boolean;
	height: number;
	alignment: LayoutBottomAlignment;
	groups: LayoutBottomGroup[];
}

export type LayoutAuxiliaryRegion = "left" | "right" | "bottom";

export interface LayoutToolRestoreTarget {
	region: LayoutAuxiliaryRegion;
	groupId?: string;
	index: number;
}

export interface WorkspaceLayoutDocument {
	version: 2;
	center: LayoutCenterNode;
	left: LayoutSideRegion;
	right: LayoutSideRegion;
	bottom: LayoutBottomRegion;
	toolRestoreTargets: Partial<Record<LayoutToolId, LayoutToolRestoreTarget>>;
}
