import {
	DEFAULT_CONFIG,
	type LayoutCenterTab,
	type LayoutPreset,
	type LayoutPresetCenterNode,
	type LayoutPresetSideRegion,
	type LayoutSideGroup,
	type LayoutSideRegion,
	type LayoutTerminalTab,
	type LayoutToolId,
	type WorkspaceLayoutDocument,
} from "@thinkrail/contracts";
import {
	collectCenterGroups,
	createLayoutId,
	LAYOUT_TOOL_DEFAULT_SIDES,
	LAYOUT_TOOLS,
	toolTab,
} from "./model";

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

const side = (
	visible: boolean,
	width: number,
	groups: Array<{ id: string; tools: LayoutToolId[]; weight?: number; folded?: boolean }>,
): LayoutPresetSideRegion => {
	const total = groups.reduce((sum, candidate) => sum + (candidate.weight ?? 1), 0);
	return {
		visible,
		width,
		groups: groups.map((candidate) => ({
			id: candidate.id,
			weight: (candidate.weight ?? 1) / total,
			folded: candidate.folded ?? false,
			tools: candidate.tools,
		})),
	};
};

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
	},
	{
		id: "focus",
		name: "Focus",
		center: group("focus-primary"),
		left: side(false, 0.18, [{ id: "focus-left", tools: ["projects"] }]),
		right: side(false, 0.26, [
			{ id: "focus-right", tools: ["specs", "files", "changes", "review"] },
		]),
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
	},
] as const;

export function minimumSideGroupLimit(preset: LayoutPreset): number {
	return Math.max(1, preset.left.groups.length, preset.right.groups.length);
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
		side,
		index: LAYOUT_TOOLS.filter(
			(candidate) => LAYOUT_TOOL_DEFAULT_SIDES[candidate] === side,
		).indexOf(tool),
	};
}

function restoreTargetsForPreset(
	preset: LayoutPreset,
): WorkspaceLayoutDocument["toolRestoreTargets"] {
	const placed = new Set(
		[...preset.left.groups, ...preset.right.groups].flatMap((group) => group.tools),
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

/** A fresh workspace starts resource-free, so unused preset center leaves prune to one deterministic leaf. */
export function instantiateLayoutPreset(preset: LayoutPreset): WorkspaceLayoutDocument {
	return {
		version: 1,
		center: { kind: "group", id: createLayoutId("center"), tabs: [] },
		left: instantiateSide(preset.left),
		right: instantiateSide(preset.right),
		toolRestoreTargets: restoreTargetsForPreset(preset),
	};
}

function flattenCenterTabs(document: WorkspaceLayoutDocument): LayoutCenterTab[] {
	return collectCenterGroups(document.center).flatMap((candidate) => candidate.tabs);
}

function flattenSideTerminals(region: LayoutSideRegion): LayoutTerminalTab[] {
	return region.groups.flatMap((candidate) =>
		candidate.tabs.filter((tab): tab is LayoutTerminalTab => tab.kind === "terminal"),
	);
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

function putTerminalsInExistingSide(
	region: LayoutSideRegion,
	terminals: LayoutTerminalTab[],
): { region: LayoutSideRegion; remaining: LayoutTerminalTab[] } {
	if (terminals.length === 0 || region.groups.length === 0) return { region, remaining: terminals };
	return {
		region: {
			...region,
			groups: region.groups.map((group, index) =>
				index === 0 ? { ...group, tabs: [...group.tabs, ...terminals] } : group,
			),
		},
		remaining: [],
	};
}

function restoreTargetsForOmittedTools(
	document: WorkspaceLayoutDocument,
	left: LayoutSideRegion,
	right: LayoutSideRegion,
): WorkspaceLayoutDocument["toolRestoreTargets"] {
	const placed = new Set(
		[...left.groups, ...right.groups]
			.flatMap((group) => group.tabs)
			.filter((tab) => tab.kind === "tool")
			.map((tab) => tab.tool),
	);
	const targets = { ...document.toolRestoreTargets };
	for (const side of ["left", "right"] as const) {
		for (const group of document[side].groups) {
			group.tabs.forEach((tab, index) => {
				if (tab.kind === "tool" && !placed.has(tab.tool)) targets[tab.tool] = { side, index };
			});
		}
	}
	for (const tool of LAYOUT_TOOLS) {
		if (placed.has(tool) || targets[tool]) continue;
		targets[tool] = defaultRestoreTarget(tool);
	}
	return targets;
}

function putTerminalsInPrimaryCenter(
	center: WorkspaceLayoutDocument["center"],
	terminals: LayoutTerminalTab[],
): WorkspaceLayoutDocument["center"] {
	if (terminals.length === 0) return center;
	if (center.kind === "group") return { ...center, tabs: [...center.tabs, ...terminals] };
	return {
		...center,
		children: [putTerminalsInPrimaryCenter(center.children[0], terminals), center.children[1]],
	};
}

/** Apply a resource-free preset while preserving every placed workspace resource identity. */
export function applyLayoutPreset(
	document: WorkspaceLayoutDocument,
	preset: LayoutPreset,
): WorkspaceLayoutDocument {
	const centerTabs = flattenCenterTabs(document);
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
	let center = filled ?? fallback;
	const existingTools = new Map(
		[...document.left.groups, ...document.right.groups]
			.flatMap((group) => group.tabs)
			.filter((tab) => tab.kind === "tool")
			.map((tab) => [tab.tool, tab] as const),
	);
	const claimedIds = new Set(
		[
			...flattenCenterTabs(document),
			...flattenSideTerminals(document.left),
			...flattenSideTerminals(document.right),
			...existingTools.values(),
		].map((tab) => tab.id),
	);
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
	let left = instantiateSide(preset.left, resolveTool);
	let right = instantiateSide(preset.right, resolveTool);
	const leftTerminals = flattenSideTerminals(document.left);
	const rightTerminals = flattenSideTerminals(document.right);
	const leftSameSide = putTerminalsInExistingSide(left, leftTerminals);
	left = leftSameSide.region;
	const rightSameSide = putTerminalsInExistingSide(right, rightTerminals);
	right = rightSameSide.region;
	const leftOpposite = putTerminalsInExistingSide(right, leftSameSide.remaining);
	right = leftOpposite.region;
	const rightOpposite = putTerminalsInExistingSide(left, rightSameSide.remaining);
	left = rightOpposite.region;
	center = putTerminalsInPrimaryCenter(center, [
		...leftOpposite.remaining,
		...rightOpposite.remaining,
	]);
	return {
		version: 1,
		center,
		left,
		right,
		toolRestoreTargets: restoreTargetsForOmittedTools(document, left, right),
	};
}

/** Capture portable topology/tool placement, excluding every workspace resource identity. */
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
		const portableGroups = region.groups
			.map((candidate) => ({
				id: candidate.id,
				weight: candidate.weight,
				folded: candidate.folded,
				tools: candidate.tabs.filter((tab) => tab.kind === "tool").map((tab) => tab.tool),
			}))
			.filter((candidate) => candidate.tools.length > 0);
		const total = portableGroups.reduce((sum, candidate) => sum + candidate.weight, 0);
		const groups = portableGroups.map((candidate) => ({
			...candidate,
			weight: candidate.weight / total,
		}));
		return { visible: region.visible && groups.length > 0, width: region.width, groups };
	};
	return {
		id,
		name,
		center: center(document.center),
		left: portableSide(document.left),
		right: portableSide(document.right),
	};
}
