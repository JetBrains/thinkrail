import type {
	BuiltinLayoutToolId,
	ExtensionLayoutToolId,
	GitDiffScope,
	LayoutPreset,
	LayoutToolId,
} from "@thinkrail/contracts";
import type { ComponentType } from "react";

export type { BuiltinLayoutToolId, ExtensionLayoutToolId, LayoutToolId };
export type LayoutBottomAlignment = LayoutPreset["bottom"]["alignment"];

/** An extension's side tool as the shell describes it; the layout never reads the extension registry. */
export interface LayoutExtensionTool {
	/** A locale key of this build, translated where the tool is named. */
	readonly titleKey: string;
	readonly icon: ComponentType<{ className?: string | undefined }>;
	readonly defaultSide: "left" | "right";
	/** Its extension is on and served: only then does an unplaced tool wait in its rail. */
	readonly offered: boolean;
}

/** The extension side tools the shell injects, by layout tool id. */
export type LayoutToolCatalog = Readonly<
	Partial<Record<ExtensionLayoutToolId, LayoutExtensionTool>>
>;

export interface LayoutFileTab {
	kind: "file";
	id: string;
	name: string;
	path: string;
}

export type LayoutDiffTab =
	| {
			kind: "diff";
			id: string;
			name: string;
			path: string;
			before?: undefined;
			scope: GitDiffScope;
	  }
	| { kind: "diff"; id: string; name: string; path: string; before: string };

export interface LayoutChangesTab {
	kind: "changes";
	id: string;
	name: string;
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

export interface LayoutExtensionTab {
	kind: "extension";
	id: string;
	name: string;
	extension: string;
	panel: string;
	titleKey: string;
	params: Readonly<Record<string, string>>;
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
	| LayoutChangesTab
	| LayoutChatTab
	| LayoutDocumentTab
	| LayoutExtensionTab
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
