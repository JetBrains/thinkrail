import {
	DEFAULT_CONFIG,
	type LayoutBottomRegion,
	type LayoutCenterTab,
	type LayoutPreset,
	type LayoutPresetBottomRegion,
	type LayoutPresetCenterNode,
	type LayoutPresetSideRegion,
	type LayoutSideGroup,
	type LayoutSideRegion,
	type LayoutTerminalTab,
	type LayoutToolId,
	type LayoutToolTab,
	type WorkspaceLayoutDocument,
} from "@thinkrail/contracts";
import {
	collectAllGroups,
	collectCenterGroups,
	createLayoutId,
	LAYOUT_TOOL_DEFAULT_SIDES,
	LAYOUT_TOOLS,
	toolTab,
} from "./model";
import type { WorkbenchAuxiliaryGroup, WorkbenchCenterNode, WorkbenchFrame } from "./normalized";

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

export const BUILTIN_LAYOUT_PRESETS: readonly LayoutPreset[] = [
	{
		id: "balanced",
		name: "Balanced",
		center: split(
			"balanced-center",
			"horizontal",
			group("balanced-primary"),
			group("balanced-secondary"),
		),
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
		BUILTIN_LAYOUT_PRESETS.find((preset) => preset.id === DEFAULT_CONFIG.layout.defaultPresetId);
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

function restoreTargetsForPreset(
	preset: LayoutPreset,
): WorkspaceLayoutDocument["toolRestoreTargets"] {
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

function instantiateSide(
	region: LayoutPresetSideRegion,
	resolveTool: (tool: LayoutToolId) => ReturnType<typeof toolTab> = toolTab,
): LayoutSideRegion {
	const weightTotal = region.groups.reduce((sum, candidate) => sum + candidate.weight, 0);
	const groups: LayoutSideGroup[] = region.groups.map((candidate) => ({
		id: createLayoutId("side"),
		weight: candidate.weight / weightTotal,
		folded: candidate.folded,
		tabs: candidate.tools.map(resolveTool),
	}));
	return { visible: region.visible && groups.length > 0, width: region.width, groups };
}

function instantiateBottom(
	region: LayoutPresetBottomRegion,
	resolveTool: (tool: LayoutToolId) => ReturnType<typeof toolTab> = toolTab,
): LayoutBottomRegion {
	const weightTotal = region.groups.reduce((sum, candidate) => sum + candidate.weight, 0);
	const groups = region.groups.map((candidate) => ({
		id: createLayoutId("bottom"),
		weight: candidate.weight / weightTotal,
		folded: candidate.folded,
		tabs: candidate.tools.map(resolveTool),
	}));
	return {
		visible: region.visible && groups.length > 0,
		height: region.height,
		alignment: region.alignment,
		groups,
	};
}

export function instantiateLayoutPreset(preset: LayoutPreset): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: { kind: "group", id: createLayoutId("center"), tabs: [] },
		left: instantiateSide(preset.left),
		right: instantiateSide(preset.right),
		bottom: instantiateBottom(preset.bottom),
		toolRestoreTargets: restoreTargetsForPreset(preset),
	};
}

function flattenCenterTabs(document: WorkspaceLayoutDocument): LayoutCenterTab[] {
	return collectCenterGroups(document.center).flatMap((candidate) => candidate.tabs);
}

function flattenTerminals(document: WorkspaceLayoutDocument): LayoutTerminalTab[] {
	return collectAllGroups(document)
		.flatMap((group) => group.tabs)
		.filter((tab): tab is LayoutTerminalTab => tab.kind === "terminal");
}

function presetLeafCount(node: LayoutPresetCenterNode): number {
	return node.kind === "group"
		? 1
		: presetLeafCount(node.children[0]) + presetLeafCount(node.children[1]);
}

function fillPresetCenter(
	node: LayoutPresetCenterNode,
	buckets: LayoutCenterTab[][],
	cursor: { value: number },
): WorkspaceLayoutDocument["center"] | null {
	if (node.kind === "group") {
		const tabs = buckets[cursor.value] ?? [];
		cursor.value += 1;
		return tabs.length > 0 ? { kind: "group", id: createLayoutId("center"), tabs } : null;
	}
	const first = fillPresetCenter(node.children[0], buckets, cursor);
	const second = fillPresetCenter(node.children[1], buckets, cursor);
	if (!first) return second;
	if (!second) return first;
	const total = node.weights[0] + node.weights[1];
	return {
		kind: "split",
		id: createLayoutId("split"),
		direction: node.direction,
		weights: [node.weights[0] / total, node.weights[1] / total],
		children: [first, second],
	};
}

function putTerminalsInBottom(
	region: LayoutBottomRegion,
	terminals: LayoutTerminalTab[],
): LayoutBottomRegion {
	if (region.groups.length === 0 && terminals.length === 0) return region;
	const seeded =
		region.groups.length > 0
			? region.groups
			: [{ id: createLayoutId("bottom"), weight: 1, folded: false, tabs: [] }];
	const groups = seeded.map((group, index) => ({
		...group,
		tabs: [...group.tabs, ...(terminals[index] ? [terminals[index]] : [])],
	}));
	if (groups[0] && terminals.length > groups.length) {
		groups[0] = { ...groups[0], tabs: [...groups[0].tabs, ...terminals.slice(groups.length)] };
	}
	return { ...region, groups };
}

function restoreTargetsForOmittedTools(
	document: WorkspaceLayoutDocument,
	left: LayoutSideRegion,
	right: LayoutSideRegion,
	bottomRegion: LayoutBottomRegion,
): WorkspaceLayoutDocument["toolRestoreTargets"] {
	const placed = new Set(
		[...left.groups, ...right.groups, ...bottomRegion.groups]
			.flatMap((group) => group.tabs)
			.filter((tab) => tab.kind === "tool")
			.map((tab) => tab.tool),
	);
	const targets = { ...document.toolRestoreTargets };
	for (const region of ["left", "right", "bottom"] as const) {
		for (const group of document[region].groups) {
			group.tabs.forEach((tab, index) => {
				if (tab.kind === "tool" && !placed.has(tab.tool)) {
					targets[tab.tool] = { region, index };
				}
			});
		}
	}
	for (const tool of LAYOUT_TOOLS) {
		if (placed.has(tool) || targets[tool]) continue;
		targets[tool] = defaultRestoreTarget(tool);
	}
	return targets;
}

export function applyLayoutPreset(
	document: WorkspaceLayoutDocument,
	preset: LayoutPreset,
): WorkspaceLayoutDocument {
	const centerTabs = flattenCenterTabs(document).filter((tab) => tab.kind !== "terminal");
	const leafCount = presetLeafCount(preset.center);
	const buckets = Array.from({ length: leafCount }, () => [] as LayoutCenterTab[]);
	for (let index = 0; index < centerTabs.length; index += 1) {
		const tab = centerTabs[index];
		if (!tab) continue;
		if (index < leafCount) buckets[index]?.push(tab);
		else buckets[0]?.push(tab);
	}
	const filled = fillPresetCenter(preset.center, buckets, { value: 0 });
	const fallback = { kind: "group" as const, id: createLayoutId("center"), tabs: [] };
	const center = filled ?? fallback;
	const allTabs = collectAllGroups(document).flatMap((group) => group.tabs);
	const existingTools = new Map(
		allTabs.filter((tab) => tab.kind === "tool").map((tab) => [tab.tool, tab] as const),
	);
	const claimedIds = new Set(allTabs.map((tab) => tab.id));
	const resolveTool = (tool: LayoutToolId): ReturnType<typeof toolTab> => {
		const existing = existingTools.get(tool);
		if (existing) {
			claimedIds.add(existing.id);
			return existing;
		}
		const canonical = toolTab(tool);
		if (!claimedIds.has(canonical.id)) {
			claimedIds.add(canonical.id);
			return canonical;
		}
		let id = createLayoutId("tool-placement");
		while (claimedIds.has(id)) id = createLayoutId("tool-placement");
		claimedIds.add(id);
		return { ...canonical, id };
	};
	const left = instantiateSide(preset.left, resolveTool);
	const right = instantiateSide(preset.right, resolveTool);
	const bottomRegion = putTerminalsInBottom(
		instantiateBottom(preset.bottom, resolveTool),
		flattenTerminals(document),
	);
	return {
		version: 2,
		center,
		left,
		right,
		bottom: bottomRegion,
		toolRestoreTargets: restoreTargetsForOmittedTools(document, left, right, bottomRegion),
	};
}

export function captureLayoutPreset(
	document: WorkspaceLayoutDocument,
	id: string,
	name: string,
): LayoutPreset {
	const center = (node: WorkspaceLayoutDocument["center"]): LayoutPresetCenterNode =>
		node.kind === "group"
			? { kind: "group", id: node.id }
			: {
					kind: "split",
					id: node.id,
					direction: node.direction,
					weights: node.weights,
					children: [center(node.children[0]), center(node.children[1])],
				};
	const portableSide = (region: LayoutSideRegion): LayoutPresetSideRegion => {
		const portableGroups = region.groups.map((candidate) => ({
			id: candidate.id,
			weight: candidate.weight,
			folded: candidate.folded,
			tools: candidate.tabs.filter((tab) => tab.kind === "tool").map((tab) => tab.tool),
		}));
		const total = portableGroups.reduce((sum, candidate) => sum + candidate.weight, 0);
		const groups = portableGroups.map((candidate) => ({
			...candidate,
			weight: candidate.weight / total,
		}));
		return { visible: region.visible && groups.length > 0, width: region.width, groups };
	};
	const portableBottom = (region: LayoutBottomRegion): LayoutPresetBottomRegion => {
		const total = region.groups.reduce((sum, candidate) => sum + candidate.weight, 0);
		return {
			visible: region.visible && region.groups.length > 0,
			height: region.height,
			alignment: region.alignment,
			groups: region.groups.map((candidate) => ({
				id: candidate.id,
				weight: candidate.weight / total,
				folded: candidate.folded,
				tools: candidate.tabs.filter((tab) => tab.kind === "tool").map((tab) => tab.tool),
			})),
		};
	};
	return {
		id,
		name,
		center: center(document.center),
		left: portableSide(document.left),
		right: portableSide(document.right),
		bottom: portableBottom(document.bottom),
	};
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
): WorkbenchFrame {
	const existingTools = new Map<LayoutToolId, LayoutToolTab>();
	if (existing) {
		for (const region of [existing.left, existing.right, existing.bottom]) {
			for (const group of region.groups) {
				for (const tool of group.tools) existingTools.set(tool.tool, tool);
			}
		}
	}
	const resolveTool = (tool: LayoutToolId): LayoutToolTab =>
		existingTools.get(tool) ?? toolTab(tool);
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
