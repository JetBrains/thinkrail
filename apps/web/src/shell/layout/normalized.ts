import { layoutResourceIdentity } from "../../lib";
import type {
	LayoutAuxiliaryRegion,
	LayoutBottomAlignment,
	LayoutCenterNode,
	LayoutCenterTab,
	LayoutTab,
	LayoutTerminalTab,
	LayoutToolId,
	LayoutToolRestoreTarget,
	LayoutToolTab,
	WorkspaceLayoutDocument,
} from "./types";

export interface WorkbenchCenterGroup {
	kind: "group";
	id: string;
}

export interface WorkbenchCenterSplit {
	kind: "split";
	id: string;
	direction: "horizontal" | "vertical";
	weights: [number, number];
	children: [WorkbenchCenterNode, WorkbenchCenterNode];
}

export type WorkbenchCenterNode = WorkbenchCenterGroup | WorkbenchCenterSplit;

export interface WorkbenchAuxiliaryGroup {
	id: string;
	weight: number;
	folded: boolean;
	tools: LayoutToolTab[];
}

export interface WorkbenchSideFrame {
	visible: boolean;
	width: number;
	groups: WorkbenchAuxiliaryGroup[];
}

export interface WorkbenchBottomFrame {
	visible: boolean;
	height: number;
	alignment: LayoutBottomAlignment;
	groups: WorkbenchAuxiliaryGroup[];
}

export interface WorkbenchFrame {
	version: 1;
	center: WorkbenchCenterNode;
	left: WorkbenchSideFrame;
	right: WorkbenchSideFrame;
	bottom: WorkbenchBottomFrame;
	toolRestoreTargets: Partial<Record<LayoutToolId, LayoutToolRestoreTarget>>;
}

export interface WorkspaceGroupView {
	tabs: LayoutCenterTab[];
	previewTabId?: string;
	beforeToolByTabId?: Record<string, LayoutToolId>;
}

export interface WorkspaceViewState {
	groups: Record<string, WorkspaceGroupView>;
}

export interface NormalizedLayoutState {
	frame: WorkbenchFrame;
	viewsByWorkspace: Record<string, WorkspaceViewState>;
}

type FrameGroupLocation = {
	area: "center" | LayoutAuxiliaryRegion;
	groupId: string;
	index: number;
};

function frameCenterFromDocument(node: LayoutCenterNode): WorkbenchCenterNode {
	if (node.kind === "group") return { kind: "group", id: node.id };
	return {
		kind: "split",
		id: node.id,
		direction: node.direction,
		weights: node.weights,
		children: [
			frameCenterFromDocument(node.children[0]),
			frameCenterFromDocument(node.children[1]),
		],
	};
}

export function collectWorkbenchCenterGroups(node: WorkbenchCenterNode): WorkbenchCenterGroup[] {
	if (node.kind === "group") return [node];
	return [
		...collectWorkbenchCenterGroups(node.children[0]),
		...collectWorkbenchCenterGroups(node.children[1]),
	];
}

function auxiliaryFrameFromDocument(
	region: WorkspaceLayoutDocument["left"] | WorkspaceLayoutDocument["bottom"],
): WorkbenchAuxiliaryGroup[] {
	return region.groups.map((group) => ({
		id: group.id,
		weight: group.weight,
		folded: group.folded,
		tools: group.tabs.filter((tab): tab is LayoutToolTab => tab.kind === "tool"),
	}));
}

export function workbenchFrameFromDocument(document: WorkspaceLayoutDocument): WorkbenchFrame {
	return {
		version: 1,
		center: frameCenterFromDocument(document.center),
		left: {
			visible: document.left.visible,
			width: document.left.width,
			groups: auxiliaryFrameFromDocument(document.left),
		},
		right: {
			visible: document.right.visible,
			width: document.right.width,
			groups: auxiliaryFrameFromDocument(document.right),
		},
		bottom: {
			visible: document.bottom.visible,
			height: document.bottom.height,
			alignment: document.bottom.alignment,
			groups: auxiliaryFrameFromDocument(document.bottom),
		},
		toolRestoreTargets: { ...document.toolRestoreTargets },
	};
}

function nextToolAnchor(tabs: readonly LayoutTab[], tabIndex: number): LayoutToolId | undefined {
	for (let index = tabIndex + 1; index < tabs.length; index += 1) {
		const candidate = tabs[index];
		if (candidate?.kind === "tool") return candidate.tool;
	}
	return undefined;
}

export function workspaceViewFromDocument(document: WorkspaceLayoutDocument): WorkspaceViewState {
	const groups = Object.create(null) as Record<string, WorkspaceGroupView>;
	const visitCenter = (node: LayoutCenterNode): void => {
		if (node.kind === "split") {
			visitCenter(node.children[0]);
			visitCenter(node.children[1]);
			return;
		}
		if (node.tabs.length > 0 || node.previewTabId) {
			groups[node.id] = {
				tabs: [...node.tabs],
				...(node.previewTabId ? { previewTabId: node.previewTabId } : {}),
			};
		}
	};
	visitCenter(document.center);
	for (const region of [document.left, document.right, document.bottom]) {
		for (const group of region.groups) {
			const tabs: LayoutTerminalTab[] = [];
			const beforeToolByTabId = Object.create(null) as Record<string, LayoutToolId>;
			group.tabs.forEach((tab, index) => {
				if (tab.kind !== "terminal") return;
				tabs.push(tab);
				const anchor = nextToolAnchor(group.tabs, index);
				if (anchor) beforeToolByTabId[tab.id] = anchor;
			});
			if (tabs.length > 0) {
				groups[group.id] = {
					tabs,
					...(Object.keys(beforeToolByTabId).length > 0 ? { beforeToolByTabId } : {}),
				};
			}
		}
	}
	return { groups };
}

function projectedCenter(
	node: WorkbenchCenterNode,
	view: WorkspaceViewState,
): WorkspaceLayoutDocument["center"] {
	if (node.kind === "split") {
		return {
			...node,
			children: [projectedCenter(node.children[0], view), projectedCenter(node.children[1], view)],
		};
	}
	const group = view.groups[node.id];
	const tabs = group?.tabs ?? [];
	const preview = group?.previewTabId
		? tabs.find(
				(tab) => tab.id === group.previewTabId && (tab.kind === "file" || tab.kind === "diff"),
			)
		: undefined;
	return {
		kind: "group",
		id: node.id,
		tabs,
		...(preview ? { previewTabId: preview.id } : {}),
	};
}

function projectedAuxiliaryTabs(
	group: WorkbenchAuxiliaryGroup,
	view: WorkspaceViewState,
): Array<LayoutToolTab | LayoutTerminalTab> {
	const workspaceGroup = view.groups[group.id];
	const terminals = (workspaceGroup?.tabs ?? []).filter(
		(tab): tab is LayoutTerminalTab => tab.kind === "terminal",
	);
	const anchored = new Map<LayoutToolId, LayoutTerminalTab[]>();
	const trailing: LayoutTerminalTab[] = [];
	for (const terminal of terminals) {
		const tool = workspaceGroup?.beforeToolByTabId?.[terminal.id];
		if (!tool || !group.tools.some((candidate) => candidate.tool === tool)) {
			trailing.push(terminal);
			continue;
		}
		const bucket = anchored.get(tool) ?? [];
		bucket.push(terminal);
		anchored.set(tool, bucket);
	}
	return [
		...group.tools.flatMap((tool) => [...(anchored.get(tool.tool) ?? []), tool]),
		...trailing,
	];
}

export function projectWorkspaceLayout(
	frame: WorkbenchFrame,
	view: WorkspaceViewState,
): WorkspaceLayoutDocument {
	const side = (region: WorkbenchSideFrame): WorkspaceLayoutDocument["left"] => ({
		visible: region.visible,
		width: region.width,
		groups: region.groups.map((group) => ({
			id: group.id,
			weight: group.weight,
			folded: group.folded,
			tabs: projectedAuxiliaryTabs(group, view),
		})),
	});
	return {
		version: 2,
		center: projectedCenter(frame.center, view),
		left: side(frame.left),
		right: side(frame.right),
		bottom: {
			visible: frame.bottom.visible,
			height: frame.bottom.height,
			alignment: frame.bottom.alignment,
			groups: frame.bottom.groups.map((group) => ({
				id: group.id,
				weight: group.weight,
				folded: group.folded,
				tabs: projectedAuxiliaryTabs(group, view),
			})),
		},
		toolRestoreTargets: { ...frame.toolRestoreTargets },
	};
}

export function emptyWorkspaceView(): WorkspaceViewState {
	return { groups: Object.create(null) as Record<string, WorkspaceGroupView> };
}

function frameLocations(frame: WorkbenchFrame): FrameGroupLocation[] {
	return [
		...collectWorkbenchCenterGroups(frame.center).map((group, index) => ({
			area: "center" as const,
			groupId: group.id,
			index,
		})),
		...(["left", "right", "bottom"] as const).flatMap((area) =>
			frame[area].groups.map((group, index) => ({ area, groupId: group.id, index })),
		),
	];
}

function locationMap(frame: WorkbenchFrame): Map<string, FrameGroupLocation> {
	return new Map(frameLocations(frame).map((location) => [location.groupId, location]));
}

function compatibleLocation(
	tab: LayoutCenterTab,
	oldLocation: FrameGroupLocation | undefined,
	nextFrame: WorkbenchFrame,
	byId: Map<string, FrameGroupLocation>,
): FrameGroupLocation {
	const exact = oldLocation ? byId.get(oldLocation.groupId) : undefined;
	if (exact && (exact.area === "center" || tab.kind === "terminal")) return exact;
	const locations = frameLocations(nextFrame);
	if (tab.kind !== "terminal") {
		const center = locations.filter((location) => location.area === "center");
		const selected = center[Math.min(oldLocation?.index ?? 0, center.length - 1)] ?? center[0];
		if (!selected) throw new Error("The workbench frame requires a center group");
		return selected;
	}
	if (oldLocation) {
		const sameArea = locations.filter((location) => location.area === oldLocation.area);
		const same = sameArea[Math.min(oldLocation.index, sameArea.length - 1)];
		if (same) return same;
	}
	const fallback =
		locations.find((location) => location.area === "bottom") ??
		locations.find((location) => location.area === "center");
	if (!fallback) throw new Error("The workbench frame requires a center group");
	return fallback;
}

function toolAnchorSurvives(
	frame: WorkbenchFrame,
	location: FrameGroupLocation,
	tool: LayoutToolId | undefined,
): tool is LayoutToolId {
	if (!tool || location.area === "center") return false;
	return (
		frame[location.area].groups
			.find((group) => group.id === location.groupId)
			?.tools.some((candidate) => candidate.tool === tool) === true
	);
}

export function reconcileWorkspaceView(
	previousFrame: WorkbenchFrame,
	nextFrame: WorkbenchFrame,
	view: WorkspaceViewState,
): WorkspaceViewState {
	const previousLocations = frameLocations(previousFrame);
	const previousById = new Map(previousLocations.map((location) => [location.groupId, location]));
	const nextById = locationMap(nextFrame);
	const groups = Object.create(null) as Record<string, WorkspaceGroupView>;
	const resourceKeys = new Set<string>();
	const append = (
		tab: LayoutCenterTab,
		source: WorkspaceGroupView,
		oldLocation: FrameGroupLocation | undefined,
	): void => {
		const resourceKey = layoutResourceIdentity(tab);
		if (resourceKeys.has(resourceKey)) return;
		resourceKeys.add(resourceKey);
		const destination = compatibleLocation(tab, oldLocation, nextFrame, nextById);
		const current = groups[destination.groupId] ?? { tabs: [] };
		const nextTabs = [...current.tabs, tab];
		const sourceAnchor = source.beforeToolByTabId?.[tab.id];
		const beforeToolByTabId = toolAnchorSurvives(nextFrame, destination, sourceAnchor)
			? { ...current.beforeToolByTabId, [tab.id]: sourceAnchor }
			: current.beforeToolByTabId;
		const previewTabId =
			destination.area === "center" && source.previewTabId === tab.id
				? (current.previewTabId ?? tab.id)
				: current.previewTabId;
		groups[destination.groupId] = {
			tabs: nextTabs,
			...(previewTabId ? { previewTabId } : {}),
			...(beforeToolByTabId && Object.keys(beforeToolByTabId).length > 0
				? { beforeToolByTabId }
				: {}),
		};
	};
	for (const location of previousLocations) {
		const source = view.groups[location.groupId];
		if (!source) continue;
		for (const tab of source.tabs) append(tab, source, location);
	}
	for (const [groupId, source] of Object.entries(view.groups)) {
		if (previousById.has(groupId)) continue;
		for (const tab of source.tabs) append(tab, source, undefined);
	}
	return { groups };
}

export function applyProjectedLayoutDocument(
	state: NormalizedLayoutState,
	workspaceId: string,
	document: WorkspaceLayoutDocument,
): NormalizedLayoutState {
	const candidateFrame = workbenchFrameFromDocument(document);
	const frame = sameWorkbenchFrame(state.frame, candidateFrame) ? state.frame : candidateFrame;
	const activeView = workspaceViewFromDocument(document);
	const previousActiveView = state.viewsByWorkspace[workspaceId];
	const nextActiveView =
		previousActiveView && sameWorkspaceView(previousActiveView, activeView)
			? previousActiveView
			: activeView;
	if (frame === state.frame) {
		return {
			frame,
			viewsByWorkspace:
				nextActiveView === previousActiveView
					? state.viewsByWorkspace
					: { ...state.viewsByWorkspace, [workspaceId]: nextActiveView },
		};
	}
	const viewsByWorkspace = Object.fromEntries(
		Object.entries(state.viewsByWorkspace).map(([id, view]) => [
			id,
			id === workspaceId ? nextActiveView : reconcileWorkspaceView(state.frame, frame, view),
		]),
	);
	viewsByWorkspace[workspaceId] = nextActiveView;
	return { frame, viewsByWorkspace };
}

export function sameWorkbenchFrame(first: WorkbenchFrame, second: WorkbenchFrame): boolean {
	return JSON.stringify(first) === JSON.stringify(second);
}

export function sameWorkspaceView(first: WorkspaceViewState, second: WorkspaceViewState): boolean {
	return JSON.stringify(first) === JSON.stringify(second);
}
