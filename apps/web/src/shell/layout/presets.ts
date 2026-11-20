import type {
	BuiltinLayoutToolId,
	LayoutPreset,
	LayoutPresetBottomRegion,
	LayoutPresetCenterNode,
	LayoutPresetSideRegion,
	LayoutToolId,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import { isPreviewCompatibleTabKind, nullProto } from "../../lib";
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
	reconcileWorkspaceView,
	type WorkbenchAuxiliaryGroup,
	type WorkbenchCenterNode,
	type WorkbenchFrame,
	type WorkbenchSideFrame,
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
			{ id: "balanced-right-top", tools: ["specs", "files", "artifacts"], weight: 1.25 },
			{ id: "balanced-right-bottom", tools: ["plan", "review"] },
		]),
		bottom: bottom(true, [{ id: "balanced-bottom", tools: [] }]),
	},
	{
		id: "focus",
		name: "Focus",
		center: group("focus-primary"),
		left: side(false, 0.18, [{ id: "focus-left", tools: ["projects"] }]),
		right: side(false, 0.26, [
			{ id: "focus-right", tools: ["specs", "files", "review", "artifacts"] },
		]),
		bottom: bottom(false, [{ id: "focus-bottom", tools: [] }]),
	},
	{
		id: "review",
		name: "Review",
		center: split("review-center", "vertical", group("review-primary"), group("review-secondary")),
		left: side(true, 0.16, [{ id: "review-left", tools: ["projects"] }]),
		right: side(true, 0.32, [
			{ id: "review-right-main", tools: ["review"], weight: 1.4 },
			{ id: "review-right-reference", tools: ["specs", "files", "artifacts"] },
		]),
		bottom: bottom(true, [{ id: "review-bottom", tools: [] }]),
	},
	{
		id: "left-tools",
		name: "Left tools",
		center: group("left-tools-primary"),
		left: side(true, 0.24, [
			{ id: "left-tools-projects", tools: ["projects"] },
			{ id: "left-tools-reference", tools: ["specs", "files", "artifacts"], weight: 1.25 },
			{ id: "left-tools-work", tools: ["plan", "review"] },
		]),
		right: side(false, 0.28, []),
		bottom: bottom(true, [{ id: "left-tools-bottom", tools: [] }]),
	},
] as const;

const BUILTIN_PRESET_NAME_KEYS: Readonly<Record<string, MessageKey>> = {
	balanced: "workbench.preset.balanced",
	focus: "workbench.preset.focus",
	review: "workbench.preset.review",
	"left-tools": "workbench.preset.leftTools",
};

export function layoutPresetName(t: Translator, preset: LayoutPreset): string {
	const key = BUILTIN_LAYOUT_PRESETS.some((builtin) => builtin.id === preset.id)
		? BUILTIN_PRESET_NAME_KEYS[preset.id]
		: undefined;
	return key ? t(key) : preset.name;
}

export function presetTools(preset: LayoutPreset): LayoutToolId[] {
	return [preset.left, preset.right, preset.bottom].flatMap((region) =>
		region.groups.flatMap((group) => group.tools),
	);
}

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

function presetRestoreSide(preset: LayoutPreset, tool: BuiltinLayoutToolId) {
	const side = LAYOUT_TOOL_DEFAULT_SIDES[tool];
	return side === "right" && preset.right.groups.length === 0 ? "left" : side;
}

function restoreTargetsForPreset(preset: LayoutPreset): WorkbenchFrame["toolRestoreTargets"] {
	const placed = new Set(
		[...preset.left.groups, ...preset.right.groups, ...preset.bottom.groups].flatMap(
			(group) => group.tools,
		),
	);
	return Object.fromEntries(
		LAYOUT_TOOLS.filter((tool) => !placed.has(tool)).map((tool) => {
			const region = presetRestoreSide(preset, tool);
			const index = LAYOUT_TOOLS.filter(
				(candidate) => presetRestoreSide(preset, candidate) === region,
			).indexOf(tool);
			return [tool, { region, index }];
		}),
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
		...(current.previewTabId || (preview && isPreviewCompatibleTabKind(tab.kind))
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
	const groups = nullProto<Record<string, WorkspaceGroupView>>();
	for (let index = 0; index < centerTabs.length; index += 1) {
		const tab = centerTabs[index];
		const target = index < centerGroups.length ? centerGroups[index] : centerGroups[0];
		if (tab && target) appendWorkspaceTab(groups, target.id, tab, previewIds.has(tab.id));
	}
	const terminalPanes = nextFrame.bottom.groups.filter((group) => group.tools.length === 0);
	const terminalTargets = terminalPanes.length > 0 ? terminalPanes : centerGroups.slice(0, 1);
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

/** A captured workbench's regions around the center: the left, right and bottom of a resource-free preset. */
export type WorkbenchSides = Pick<LayoutPreset, "left" | "right" | "bottom">;

/** A view's arrangement: its own tools, each leading a pane of the left side or of the bottom. */
export interface WorkbenchViewArrangement {
	left?: LayoutToolId | undefined;
	bottom?: LayoutToolId | undefined;
	leftWidth: number;
	bottomHeight: number;
}

const VIEW_GROUP_WEIGHT = 0.7;

function centerNodeIds(node: WorkbenchCenterNode): string[] {
	return node.kind === "group"
		? [node.id]
		: [node.id, ...centerNodeIds(node.children[0]), ...centerNodeIds(node.children[1])];
}

function renormalized(groups: WorkbenchAuxiliaryGroup[]): WorkbenchAuxiliaryGroup[] {
	const total = groups.reduce((sum, group) => sum + group.weight, 0);
	return total > 0 ? groups.map((group) => ({ ...group, weight: group.weight / total })) : groups;
}

function frameToolTabs(frame: WorkbenchFrame): Map<LayoutToolId, LayoutToolTab> {
	const tools = new Map<LayoutToolId, LayoutToolTab>();
	for (const region of [frame.left, frame.right, frame.bottom]) {
		for (const group of region.groups) {
			for (const tool of group.tools) tools.set(tool.tool, tool);
		}
	}
	return tools;
}

function frameGroupIdSet(frame: WorkbenchFrame): Set<string> {
	return new Set([
		...collectWorkbenchCenterGroups(frame.center).map((group) => group.id),
		...[frame.left, frame.right, frame.bottom].flatMap((region) =>
			region.groups.map((group) => group.id),
		),
	]);
}

function reconciledViews(
	state: NormalizedLayoutState,
	next: WorkbenchFrame,
): Record<string, WorkspaceViewState> {
	const kept = frameGroupIdSet(next);
	return Object.fromEntries(
		Object.entries(state.viewsByWorkspace).map(([workspaceId, view]) => [
			workspaceId,
			Object.keys(view.groups).every((id) => kept.has(id))
				? view
				: reconcileWorkspaceView(state.frame, next, view),
		]),
	);
}

export function captureWorkbenchSides(frame: WorkbenchFrame): WorkbenchSides {
	const { left, right, bottom } = captureWorkbenchPreset(frame, "sides", "sides");
	return { left, right, bottom };
}

/**
 * Enters a view: its tools lead the left side and the bottom in panes of their own, and every group those
 * regions held stays where it was, folded, with its id, tools and terminals — so no workspace resource
 * moves and the center is untouched. A view's tool placed elsewhere leaves that group (a tool group left
 * empty goes). The right side and the restore targets stay as they are.
 */
export function arrangeWorkbenchView(
	state: NormalizedLayoutState,
	view: WorkbenchViewArrangement,
): NormalizedLayoutState {
	const { frame } = state;
	const placed = new Set([view.left, view.bottom].filter((tool) => tool !== undefined));
	const existingTools = frameToolTabs(frame);
	const strip = (groups: readonly WorkbenchAuxiliaryGroup[]) =>
		groups.flatMap((group) => {
			const tools = group.tools.filter((tool) => !placed.has(tool.tool));
			if (tools.length === group.tools.length) return [group];
			return tools.length === 0 ? [] : [{ ...group, tools }];
		});
	const left = strip(frame.left.groups);
	const right = strip(frame.right.groups);
	const bottom = strip(frame.bottom.groups);
	const claimedIds = new Set([
		...workspaceResourcePlacementIds(state.viewsByWorkspace),
		...[...left, ...right, ...bottom].flatMap((group) => group.tools.map((tool) => tool.id)),
	]);
	const takenGroupIds = frameGroupIdSet(frame);
	const lead = (
		tool: LayoutToolId,
		prefix: string,
		rest: readonly WorkbenchAuxiliaryGroup[],
	): WorkbenchAuxiliaryGroup[] => {
		let id = createLayoutId(prefix);
		while (takenGroupIds.has(id)) id = createLayoutId(prefix);
		takenGroupIds.add(id);
		const leading: WorkbenchAuxiliaryGroup = {
			id,
			weight: rest.length === 0 ? 1 : VIEW_GROUP_WEIGHT,
			folded: false,
			tools: [claimToolPlacementId(existingTools.get(tool) ?? toolTab(tool), claimedIds)],
		};
		const restTotal = rest.reduce((sum, group) => sum + group.weight, 0);
		return [
			leading,
			...rest.map((group) => ({
				...group,
				folded: true,
				weight: restTotal > 0 ? (group.weight / restTotal) * (1 - VIEW_GROUP_WEIGHT) : group.weight,
			})),
		];
	};
	const toolRestoreTargets = { ...frame.toolRestoreTargets };
	for (const tool of placed) delete toolRestoreTargets[tool];
	const next: WorkbenchFrame = {
		...frame,
		left: view.left
			? { visible: true, width: view.leftWidth, groups: lead(view.left, "left-group", left) }
			: { ...frame.left, groups: renormalized(left) },
		right: { ...frame.right, groups: renormalized(right) },
		bottom: view.bottom
			? {
					visible: true,
					height: view.bottomHeight,
					alignment: view.left ? "center-left" : frame.bottom.alignment,
					groups: lead(view.bottom, "bottom-group", bottom),
				}
			: { ...frame.bottom, groups: renormalized(bottom) },
		toolRestoreTargets,
	};
	return { frame: next, viewsByWorkspace: reconciledViews(state, next) };
}

/**
 * Restores captured sides and bottom: each captured group comes back with its id (a fresh one only where
 * the center took it), geometry, fold and tools, placed tools keeping their placement ids; `restoreTargets`
 * replace the frame's for every tool left unplaced. The center is untouched, and only a view holding a
 * resource in a group that is gone now is reconciled, so restoring the frame a view replaced is exact.
 */
export function restoreWorkbenchSides(
	state: NormalizedLayoutState,
	sides: WorkbenchSides,
	restoreTargets: WorkbenchFrame["toolRestoreTargets"],
): NormalizedLayoutState {
	const { frame } = state;
	const existingTools = frameToolTabs(frame);
	const claimedIds = new Set(workspaceResourcePlacementIds(state.viewsByWorkspace));
	const resolveTool = (tool: LayoutToolId): LayoutToolTab =>
		claimToolPlacementId(existingTools.get(tool) ?? toolTab(tool), claimedIds);
	const takenGroupIds = new Set(centerNodeIds(frame.center));
	const groups = (
		captured: LayoutPresetSideRegion["groups"],
		prefix: string,
	): WorkbenchAuxiliaryGroup[] =>
		captured.map((group) => {
			let id = group.id;
			while (takenGroupIds.has(id)) id = createLayoutId(prefix);
			takenGroupIds.add(id);
			return {
				id,
				weight: group.weight,
				folded: group.folded,
				tools: group.tools.map(resolveTool),
			};
		});
	const side = (region: LayoutPresetSideRegion, prefix: string): WorkbenchSideFrame => {
		const restored = groups(region.groups, prefix);
		return {
			visible: region.visible && restored.length > 0,
			width: region.width,
			groups: restored,
		};
	};
	const left = side(sides.left, "left-group");
	const right = side(sides.right, "right-group");
	const bottomGroups = groups(sides.bottom.groups, "bottom-group");
	const placed = new Set(
		[...left.groups, ...right.groups, ...bottomGroups].flatMap((group) =>
			group.tools.map((tool) => tool.tool),
		),
	);
	const toolRestoreTargets: WorkbenchFrame["toolRestoreTargets"] = { ...restoreTargets };
	for (const tool of placed) delete toolRestoreTargets[tool];
	const next: WorkbenchFrame = {
		version: 1,
		center: frame.center,
		left,
		right,
		bottom: {
			visible: sides.bottom.visible,
			height: sides.bottom.height,
			alignment: sides.bottom.alignment,
			groups: bottomGroups,
		},
		toolRestoreTargets,
	};
	return { frame: next, viewsByWorkspace: reconciledViews(state, next) };
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

const GEOMETRY_TOLERANCE = 0.001;

function numbersMatch(a: number, b: number): boolean {
	return Math.abs(a - b) < GEOMETRY_TOLERANCE;
}

function centerTopologyMatches(
	frame: WorkbenchCenterNode,
	preset: LayoutPresetCenterNode,
): boolean {
	if (frame.kind !== preset.kind) return false;
	if (frame.kind === "group") return true;
	if (preset.kind !== "split") return false;
	if (frame.direction !== preset.direction) return false;
	if (!numbersMatch(frame.weights[0], preset.weights[0])) return false;
	if (!numbersMatch(frame.weights[1], preset.weights[1])) return false;
	return (
		centerTopologyMatches(frame.children[0], preset.children[0]) &&
		centerTopologyMatches(frame.children[1], preset.children[1])
	);
}

function auxiliaryGroupsMatch(
	frameGroups: readonly WorkbenchAuxiliaryGroup[],
	presetGroups: readonly { weight: number; folded: boolean; tools: LayoutToolId[] }[],
): boolean {
	if (frameGroups.length !== presetGroups.length) return false;
	return frameGroups.every((fg, i) => {
		const pg = presetGroups[i];
		if (!pg) return false;
		if (!numbersMatch(fg.weight, pg.weight)) return false;
		if (fg.folded !== pg.folded) return false;
		if (fg.tools.length !== pg.tools.length) return false;
		return fg.tools.every((tool, j) => tool.tool === pg.tools[j]);
	});
}

export function frameMatchesPreset(frame: WorkbenchFrame, preset: LayoutPreset): boolean {
	if (!centerTopologyMatches(frame.center, preset.center)) return false;

	if (frame.left.visible !== preset.left.visible) return false;
	if (!numbersMatch(frame.left.width, preset.left.width)) return false;
	if (!auxiliaryGroupsMatch(frame.left.groups, preset.left.groups)) return false;

	if (frame.right.visible !== preset.right.visible) return false;
	if (!numbersMatch(frame.right.width, preset.right.width)) return false;
	if (!auxiliaryGroupsMatch(frame.right.groups, preset.right.groups)) return false;

	if (frame.bottom.visible !== preset.bottom.visible) return false;
	if (!numbersMatch(frame.bottom.height, preset.bottom.height)) return false;
	if (frame.bottom.alignment !== preset.bottom.alignment) return false;
	if (!auxiliaryGroupsMatch(frame.bottom.groups, preset.bottom.groups)) return false;

	return true;
}
