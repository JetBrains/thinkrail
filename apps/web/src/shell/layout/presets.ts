import type {
	LayoutPreset,
	LayoutPresetBottomRegion,
	LayoutPresetCenterNode,
	LayoutPresetSideRegion,
	LayoutToolId,
} from "@thinkrail/contracts";
import {
	collectAllGroups,
	collectCenterGroups,
	createLayoutId,
	LAYOUT_TOOL_DEFAULT_SIDES,
	LAYOUT_TOOLS,
	toolTab,
} from "./model";
import {
	collectWorkbenchCenterGroups,
	type NormalizedLayoutState,
	projectWorkspaceLayout,
	type WorkbenchAuxiliaryGroup,
	type WorkbenchCenterNode,
	type WorkbenchFrame,
	type WorkspaceGroupView,
	type WorkspaceViewState,
} from "./normalized";
import type { LayoutCenterTab, LayoutTerminalTab, LayoutToolTab } from "./types";

const group = (id: string): LayoutPresetCenterNode => ({ kind: "group", id });
const split = (
	id: string,
	direction: "horizontal" | "vertical",
	first: LayoutPresetCenterNode,
	second: LayoutPresetCenterNode,
): LayoutPresetCenterNode => ({
	kind: "split",
	id,
	direction,
	weights: [0.5, 0.5],
	children: [first, second],
});

const weightedGroups = (
	groups: Array<{ id: string; tools: LayoutToolId[]; weight?: number; folded?: boolean }>,
) => {
	const total = groups.reduce((sum, candidate) => sum + (candidate.weight ?? 1), 0);
	return groups.map((candidate) => ({
		id: candidate.id,
		weight: (candidate.weight ?? 1) / total,
		folded: candidate.folded ?? false,
		tools: candidate.tools,
	}));
};

const side = (
	visible: boolean,
	width: number,
	groups: Array<{ id: string; tools: LayoutToolId[]; weight?: number; folded?: boolean }>,
): LayoutPresetSideRegion => ({ visible, width, groups: weightedGroups(groups) });

const bottom = (
	visible: boolean,
	groups: Array<{ id: string; tools: LayoutToolId[]; weight?: number; folded?: boolean }>,
): LayoutPresetBottomRegion => ({
	visible,
	height: 0.3,
	alignment: "center",
	groups: weightedGroups(groups),
});

export const DEFAULT_LAYOUT_PRESET_ID = "balanced";

export const BUILTIN_LAYOUT_PRESETS: readonly LayoutPreset[] = [
	{
		id: "balanced",
		name: "Balanced",
		center: group("balanced-primary"),
		left: side(true, 0.18, [{ id: "balanced-left", tools: ["projects"] }]),
		right: side(true, 0.28, [
			{ id: "balanced-right-top", tools: ["specs", "files"], weight: 1.25 },
			{ id: "balanced-right-bottom", tools: ["changes", "review"] },
		]),
		bottom: bottom(true, [{ id: "balanced-bottom", tools: [] }]),
	},
	{
		id: "focus",
		name: "Focus",
		center: group("focus-primary"),
		left: side(false, 0.18, [{ id: "focus-left", tools: ["projects"] }]),
		right: side(false, 0.26, [
			{ id: "focus-right", tools: ["specs", "files", "changes", "review"] },
		]),
		bottom: bottom(false, [{ id: "focus-bottom", tools: [] }]),
	},
	{
		id: "review",
		name: "Review",
		center: split("review-center", "vertical", group("review-primary"), group("review-secondary")),
		left: side(true, 0.16, [{ id: "review-left", tools: ["projects"] }]),
		right: side(true, 0.32, [
			{ id: "review-right-main", tools: ["changes", "review"], weight: 1.4 },
			{ id: "review-right-reference", tools: ["specs", "files"] },
		]),
		bottom: bottom(true, [{ id: "review-bottom", tools: [] }]),
	},
] as const;

export function minimumSideGroupLimit(preset: LayoutPreset): number {
	return Math.max(1, preset.left.groups.length, preset.right.groups.length);
}

export function minimumBottomGroupLimit(preset: LayoutPreset): number {
	return Math.max(1, preset.bottom.groups.length);
}

export function resolveLayoutPreset(
	id: string,
	customPresets: readonly LayoutPreset[],
): LayoutPreset {
	const resolved =
		BUILTIN_LAYOUT_PRESETS.find((preset) => preset.id === id) ??
		customPresets.find((preset) => preset.id === id) ??
		BUILTIN_LAYOUT_PRESETS.find((preset) => preset.id === DEFAULT_LAYOUT_PRESET_ID);
	if (!resolved) throw new Error("The default layout preset is missing");
	return resolved;
}

function defaultRestoreTarget(tool: LayoutToolId) {
	const side = LAYOUT_TOOL_DEFAULT_SIDES[tool];
	return {
		region: side,
		index: LAYOUT_TOOLS.filter(
			(candidate) => LAYOUT_TOOL_DEFAULT_SIDES[candidate] === side,
		).indexOf(tool),
	};
}

function restoreTargetsForPreset(preset: LayoutPreset): WorkbenchFrame["toolRestoreTargets"] {
	const placed = new Set(
		[...preset.left.groups, ...preset.right.groups, ...preset.bottom.groups].flatMap(
			(group) => group.tools,
		),
	);
	return Object.fromEntries(
		LAYOUT_TOOLS.filter((tool) => !placed.has(tool)).map((tool) => [
			tool,
			defaultRestoreTarget(tool),
		]),
	);
}

function instantiateFrameCenter(node: LayoutPresetCenterNode): WorkbenchCenterNode {
	if (node.kind === "group") return { kind: "group", id: createLayoutId("center") };
	return {
		kind: "split",
		id: createLayoutId("split"),
		direction: node.direction,
		weights: node.weights,
		children: [instantiateFrameCenter(node.children[0]), instantiateFrameCenter(node.children[1])],
	};
}

function claimToolPlacementId(tool: LayoutToolTab, claimedIds: Set<string>): LayoutToolTab {
	if (!claimedIds.has(tool.id)) {
		claimedIds.add(tool.id);
		return tool;
	}
	let id = createLayoutId("tool-placement");
	while (claimedIds.has(id)) id = createLayoutId("tool-placement");
	claimedIds.add(id);
	return { ...tool, id };
}

function instantiateFrameGroups(
	groups: readonly { weight: number; folded: boolean; tools: LayoutToolId[] }[],
	prefix: string,
	resolveTool: (tool: LayoutToolId) => LayoutToolTab,
): WorkbenchAuxiliaryGroup[] {
	const total = groups.reduce((sum, group) => sum + group.weight, 0);
	return groups.map((group) => ({
		id: createLayoutId(prefix),
		weight: group.weight / total,
		folded: group.folded,
		tools: group.tools.map(resolveTool),
	}));
}

export function instantiateWorkbenchFrame(
	preset: LayoutPreset,
	existing?: WorkbenchFrame,
	claimedResourceIds: readonly string[] = [],
): WorkbenchFrame {
	const existingTools = new Map<LayoutToolId, LayoutToolTab>();
	if (existing) {
		for (const region of [existing.left, existing.right, existing.bottom]) {
			for (const group of region.groups) {
				for (const tool of group.tools) existingTools.set(tool.tool, tool);
			}
		}
	}
	const claimedIds = new Set(claimedResourceIds);
	const resolveTool = (tool: LayoutToolId): LayoutToolTab =>
		claimToolPlacementId(existingTools.get(tool) ?? toolTab(tool), claimedIds);
	const leftGroups = instantiateFrameGroups(preset.left.groups, "left-group", resolveTool);
	const rightGroups = instantiateFrameGroups(preset.right.groups, "right-group", resolveTool);
	const bottomGroups = instantiateFrameGroups(preset.bottom.groups, "bottom-group", resolveTool);
	const restoreTargets = restoreTargetsForPreset(preset);
	return {
		version: 1,
		center: instantiateFrameCenter(preset.center),
		left: {
			visible: preset.left.visible && leftGroups.length > 0,
			width: preset.left.width,
			groups: leftGroups,
		},
		right: {
			visible: preset.right.visible && rightGroups.length > 0,
			width: preset.right.width,
			groups: rightGroups,
		},
		bottom: {
			visible: preset.bottom.visible && bottomGroups.length > 0,
			height: preset.bottom.height,
			alignment: preset.bottom.alignment,
			groups: bottomGroups,
		},
		toolRestoreTargets: restoreTargets,
	};
}

function appendWorkspaceTab(
	groups: Record<string, WorkspaceGroupView>,
	groupId: string,
	tab: LayoutCenterTab,
	preview: boolean,
): void {
	const current = groups[groupId] ?? { tabs: [] };
	groups[groupId] = {
		tabs: [...current.tabs, tab],
		...(current.previewTabId || (preview && (tab.kind === "file" || tab.kind === "diff"))
			? { previewTabId: current.previewTabId ?? tab.id }
			: {}),
	};
}

export function reflowWorkspaceViewForFrame(
	currentFrame: WorkbenchFrame,
	view: WorkspaceViewState,
	nextFrame: WorkbenchFrame,
): WorkspaceViewState {
	const current = projectWorkspaceLayout(currentFrame, view);
	const centerTabs = collectCenterGroups(current.center)
		.flatMap((group) => group.tabs)
		.filter((tab) => tab.kind !== "terminal");
	const previewIds = new Set(
		collectCenterGroups(current.center).flatMap((group) =>
			group.previewTabId ? [group.previewTabId] : [],
		),
	);
	const terminals = collectAllGroups(current)
		.flatMap((group) => group.tabs)
		.filter((tab): tab is LayoutTerminalTab => tab.kind === "terminal");
	const centerGroups = collectWorkbenchCenterGroups(nextFrame.center);
	const groups = Object.create(null) as Record<string, WorkspaceGroupView>;
	for (let index = 0; index < centerTabs.length; index += 1) {
		const tab = centerTabs[index];
		const target = index < centerGroups.length ? centerGroups[index] : centerGroups[0];
		if (tab && target) appendWorkspaceTab(groups, target.id, tab, previewIds.has(tab.id));
	}
	const terminalTargets =
		nextFrame.bottom.groups.length > 0 ? nextFrame.bottom.groups : centerGroups.slice(0, 1);
	for (let index = 0; index < terminals.length; index += 1) {
		const tab = terminals[index];
		const target = index < terminalTargets.length ? terminalTargets[index] : terminalTargets[0];
		if (tab && target) appendWorkspaceTab(groups, target.id, tab, false);
	}
	return { groups };
}

function workspaceResourcePlacementIds(
	viewsByWorkspace: Record<string, WorkspaceViewState>,
): string[] {
	return Object.values(viewsByWorkspace).flatMap((view) =>
		Object.values(view.groups).flatMap((group) => group.tabs.map((tab) => tab.id)),
	);
}

export function ensureWorkbenchToolPlacementIds(
	frame: WorkbenchFrame,
	viewsByWorkspace: Record<string, WorkspaceViewState>,
): WorkbenchFrame {
	const claimedIds = new Set(workspaceResourcePlacementIds(viewsByWorkspace));
	let changed = false;
	const groups = (values: readonly WorkbenchAuxiliaryGroup[]): WorkbenchAuxiliaryGroup[] =>
		values.map((group) => {
			const tools = group.tools.map((tool) => {
				const claimed = claimToolPlacementId(tool, claimedIds);
				if (claimed !== tool) changed = true;
				return claimed;
			});
			return tools.every((tool, index) => tool === group.tools[index])
				? group
				: { ...group, tools };
		});
	const left = groups(frame.left.groups);
	const right = groups(frame.right.groups);
	const bottom = groups(frame.bottom.groups);
	return changed
		? {
				...frame,
				left: { ...frame.left, groups: left },
				right: { ...frame.right, groups: right },
				bottom: { ...frame.bottom, groups: bottom },
			}
		: frame;
}

export function applyWorkbenchPreset(
	state: NormalizedLayoutState,
	preset: LayoutPreset,
): NormalizedLayoutState {
	const frame = instantiateWorkbenchFrame(
		preset,
		state.frame,
		workspaceResourcePlacementIds(state.viewsByWorkspace),
	);
	return {
		frame,
		viewsByWorkspace: Object.fromEntries(
			Object.entries(state.viewsByWorkspace).map(([workspaceId, view]) => [
				workspaceId,
				reflowWorkspaceViewForFrame(state.frame, view, frame),
			]),
		),
	};
}

export function captureWorkbenchPreset(
	frame: WorkbenchFrame,
	id: string,
	name: string,
): LayoutPreset {
	const center = (node: WorkbenchCenterNode): LayoutPresetCenterNode =>
		node.kind === "group"
			? { kind: "group", id: node.id }
			: {
					kind: "split",
					id: node.id,
					direction: node.direction,
					weights: node.weights,
					children: [center(node.children[0]), center(node.children[1])],
				};
	const groups = (values: readonly WorkbenchAuxiliaryGroup[]) =>
		values.map((group) => ({
			id: group.id,
			weight: group.weight,
			folded: group.folded,
			tools: group.tools.map((tool) => tool.tool),
		}));
	return {
		id,
		name,
		center: center(frame.center),
		left: {
			visible: frame.left.visible,
			width: frame.left.width,
			groups: groups(frame.left.groups),
		},
		right: {
			visible: frame.right.visible,
			width: frame.right.width,
			groups: groups(frame.right.groups),
		},
		bottom: {
			visible: frame.bottom.visible,
			height: frame.bottom.height,
			alignment: frame.bottom.alignment,
			groups: groups(frame.bottom.groups),
		},
	};
}
