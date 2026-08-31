import {
	type LayoutAttention,
	layoutResourceIdentity,
	randomId,
	readLayoutNavigationClock,
	readLayoutSelection,
} from "../../lib";
import type {
	LayoutAuxiliaryRegion,
	LayoutBottomAlignment,
	LayoutBottomRegion,
	LayoutCenterGroup,
	LayoutCenterNode,
	LayoutCenterSplit,
	LayoutCenterTab,
	LayoutSideGroup,
	LayoutSideRegion,
	LayoutSideTab,
	LayoutTab,
	LayoutToolId,
	LayoutToolTab,
	WorkspaceLayoutDocument,
} from "./types";

export const LAYOUT_LIMITS = {
	maxCenterGroups: 4,
	maxDepth: 8,
	maxTabs: 256,
	maxSideGroupsSafety: 32,
	minCenterWidth: 320,
	minCenterHeight: 180,
	minSideBodyHeight: 120,
	minBottomBodyHeight: 120,
	minBottomGroupWidth: 160,
	foldedSideHeight: 27,
	foldedBottomWidth: 27,
	initialBottomHeight: 0.3,
	maxBottomHeight: 0.7,
} as const;

export type LayoutSide = "left" | "right";
export type LayoutAuxiliary = LayoutAuxiliaryRegion;
export type CenterSplitDirection = "left" | "right" | "up" | "down";
export type LayoutGroupLocation =
	| { area: "center"; groupId: string }
	| { area: LayoutAuxiliaryRegion; groupId: string };

export type { LayoutAttention } from "../../lib";

export interface LayoutMutationResult {
	document: WorkspaceLayoutDocument;
	focusGroupId?: string;
	focusTabId?: string;
}

export interface LayoutUnavailable {
	reason: string;
}

export type LayoutOperationResult = LayoutMutationResult | LayoutUnavailable;

export function isLayoutUnavailable(result: LayoutOperationResult): result is LayoutUnavailable {
	return "reason" in result;
}

export function createLayoutId(prefix: string): string {
	return randomId(prefix);
}

export const LAYOUT_TOOLS: readonly LayoutToolId[] = [
	"projects",
	"specs",
	"files",
	"changes",
	"review",
];

export const LAYOUT_TOOL_DEFAULT_SIDES: Record<LayoutToolId, LayoutSide> = {
	projects: "left",
	specs: "right",
	files: "right",
	changes: "right",
	review: "right",
};

const LAYOUT_TOOL_NAMES: Record<LayoutToolId, string> = {
	projects: "Projects",
	specs: "Specs",
	files: "Files",
	changes: "Changes",
	review: "Review",
};

export function layoutTabName(tab: LayoutTab): string {
	return tab.kind === "tool" ? LAYOUT_TOOL_NAMES[tab.tool] : tab.name;
}

export function toolTab(tool: LayoutToolId): LayoutToolTab {
	return { kind: "tool", id: `tool:${tool}`, name: LAYOUT_TOOL_NAMES[tool], tool };
}

export function collectCenterGroups(node: LayoutCenterNode): LayoutCenterGroup[] {
	if (node.kind === "group") return [node];
	return [...collectCenterGroups(node.children[0]), ...collectCenterGroups(node.children[1])];
}

export function collectAllGroups(document: WorkspaceLayoutDocument): Array<{
	location: LayoutGroupLocation;
	tabs: LayoutTab[];
	folded: boolean;
}> {
	return [
		...collectCenterGroups(document.center).map((group) => ({
			location: { area: "center" as const, groupId: group.id },
			tabs: group.tabs,
			folded: false,
		})),
		...document.left.groups.map((group) => ({
			location: { area: "left" as const, groupId: group.id },
			tabs: group.tabs,
			folded: group.folded,
		})),
		...document.right.groups.map((group) => ({
			location: { area: "right" as const, groupId: group.id },
			tabs: group.tabs,
			folded: group.folded,
		})),
		...document.bottom.groups.map((group) => ({
			location: { area: "bottom" as const, groupId: group.id },
			tabs: group.tabs,
			folded: group.folded,
		})),
	];
}

export function findTabLocation(
	document: WorkspaceLayoutDocument,
	tabId: string,
): LayoutGroupLocation | null {
	for (const group of collectAllGroups(document)) {
		if (group.tabs.some((tab) => tab.id === tabId)) return group.location;
	}
	return null;
}

export function findLayoutTab(document: WorkspaceLayoutDocument, tabId: string): LayoutTab | null {
	for (const group of collectAllGroups(document)) {
		const tab = group.tabs.find((candidate) => candidate.id === tabId);
		if (tab) return tab;
	}
	return null;
}

export function withAvailablePlacementId<T extends LayoutTab>(
	document: WorkspaceLayoutDocument,
	tab: T,
): T {
	const exact = findLayoutTab(document, tab.id);
	if (!exact || layoutResourceIdentity(exact) === layoutResourceIdentity(tab)) return tab;
	let id = createLayoutId(`${tab.kind}-placement`);
	while (findLayoutTab(document, id)) id = createLayoutId(`${tab.kind}-placement`);
	return { ...tab, id };
}

export function findCenterGroup(node: LayoutCenterNode, groupId: string): LayoutCenterGroup | null {
	if (node.kind === "group") return node.id === groupId ? node : null;
	return findCenterGroup(node.children[0], groupId) ?? findCenterGroup(node.children[1], groupId);
}

export function findAuxiliaryGroup(
	document: WorkspaceLayoutDocument,
	region: LayoutAuxiliaryRegion,
	groupId: string,
): LayoutSideGroup | null {
	return document[region].groups.find((group) => group.id === groupId) ?? null;
}

export function findSideGroup(
	document: WorkspaceLayoutDocument,
	side: LayoutSide,
	groupId: string,
): LayoutSideGroup | null {
	return findAuxiliaryGroup(document, side, groupId);
}

export function primaryCenterGroupId(document: WorkspaceLayoutDocument): string {
	let node = document.center;
	while (node.kind === "split") node = node.children[0];
	return node.id;
}

function updateCenterGroup(
	node: LayoutCenterNode,
	groupId: string,
	update: (group: LayoutCenterGroup) => LayoutCenterGroup,
): LayoutCenterNode {
	if (node.kind === "group") return node.id === groupId ? update(node) : node;
	const first = updateCenterGroup(node.children[0], groupId, update);
	const second = updateCenterGroup(node.children[1], groupId, update);
	if (first === node.children[0] && second === node.children[1]) return node;
	return { ...node, children: [first, second] };
}

function replaceCenterGroup(
	node: LayoutCenterNode,
	groupId: string,
	replacement: LayoutCenterNode,
): LayoutCenterNode {
	if (node.kind === "group") return node.id === groupId ? replacement : node;
	return {
		...node,
		children: [
			replaceCenterGroup(node.children[0], groupId, replacement),
			replaceCenterGroup(node.children[1], groupId, replacement),
		],
	};
}

function removeCenterGroup(node: LayoutCenterNode, groupId: string): LayoutCenterNode | null {
	if (node.kind === "group") return node.id === groupId ? null : node;
	const first = removeCenterGroup(node.children[0], groupId);
	const second = removeCenterGroup(node.children[1], groupId);
	if (!first) return second;
	if (!second) return first;
	return { ...node, children: [first, second] };
}

function normalizeWeights(weights: [number, number]): [number, number] {
	const first = Number.isFinite(weights[0]) && weights[0] > 0 ? weights[0] : 1;
	const second = Number.isFinite(weights[1]) && weights[1] > 0 ? weights[1] : 1;
	const total = first + second;
	return Number.isFinite(total) ? [first / total, second / total] : [0.5, 0.5];
}

function withGroupTabs(
	group: LayoutCenterGroup,
	tabs: LayoutCenterTab[],
	previewTabId?: string,
): LayoutCenterGroup {
	const base: LayoutCenterGroup = { kind: "group", id: group.id, tabs };
	return previewTabId ? { ...base, previewTabId } : base;
}

function removeTabFromCenter(
	node: LayoutCenterNode,
	tabId: string,
): { node: LayoutCenterNode; sourceGroupId: string | null } {
	let sourceGroupId: string | null = null;
	const next = mapCenter(node, (group) => {
		if (!group.tabs.some((tab) => tab.id === tabId)) return group;
		sourceGroupId = group.id;
		const tabs = group.tabs.filter((tab) => tab.id !== tabId);
		return withGroupTabs(
			group,
			tabs,
			group.previewTabId === tabId ? undefined : group.previewTabId,
		);
	});
	return { node: next, sourceGroupId };
}

function mapCenter(
	node: LayoutCenterNode,
	map: (group: LayoutCenterGroup) => LayoutCenterGroup,
): LayoutCenterNode {
	if (node.kind === "group") return map(node);
	return {
		...node,
		children: [mapCenter(node.children[0], map), mapCenter(node.children[1], map)],
	};
}

function removeTabFromSide(region: LayoutSideRegion, tabId: string): LayoutSideRegion {
	if (!region.groups.some((group) => group.tabs.some((tab) => tab.id === tabId))) return region;
	return {
		...region,
		groups: region.groups.map((group) => ({
			...group,
			tabs: group.tabs.filter((tab) => tab.id !== tabId),
		})),
	};
}

function removeTabFromBottom(region: LayoutBottomRegion, tabId: string): LayoutBottomRegion {
	if (!region.groups.some((group) => group.tabs.some((tab) => tab.id === tabId))) return region;
	return {
		...region,
		groups: region.groups.map((group) => ({
			...group,
			tabs: group.tabs.filter((tab) => tab.id !== tabId),
		})),
	};
}

function removeTabEverywhere(
	document: WorkspaceLayoutDocument,
	tabId: string,
): WorkspaceLayoutDocument {
	const centerResult = removeTabFromCenter(document.center, tabId);
	return {
		...document,
		center: centerResult.node,
		left: removeTabFromSide(document.left, tabId),
		right: removeTabFromSide(document.right, tabId),
		bottom: removeTabFromBottom(document.bottom, tabId),
	};
}

export function removeLayoutGroup(
	document: WorkspaceLayoutDocument,
	location: LayoutGroupLocation,
): LayoutOperationResult {
	if (location.area === "center") {
		const groups = collectCenterGroups(document.center);
		if (groups.length === 1) return { reason: "The final center group cannot be removed." };
		const sourceIndex = groups.findIndex((group) => group.id === location.groupId);
		if (sourceIndex < 0) return { reason: "The center group no longer exists." };
		const source = groups[sourceIndex];
		const target = groups[sourceIndex > 0 ? sourceIndex - 1 : 1];
		if (!source || !target) return { reason: "The center group no longer exists." };
		const moved = updateCenterGroup(document.center, target.id, (group) =>
			withGroupTabs(
				group,
				[...group.tabs, ...source.tabs],
				group.previewTabId ?? source.previewTabId,
			),
		);
		const center = removeCenterGroup(moved, source.id);
		if (!center) return { reason: "The final center group cannot be removed." };
		const focusTab = source.tabs[0] ?? target.tabs[0];
		return {
			document: { ...document, center },
			focusGroupId: target.id,
			...(focusTab ? { focusTabId: focusTab.id } : {}),
		};
	}
	const region = document[location.area];
	const sourceIndex = region.groups.findIndex((group) => group.id === location.groupId);
	if (sourceIndex < 0) return { reason: "The auxiliary group no longer exists." };
	const source = region.groups[sourceIndex];
	if (!source) return { reason: "The auxiliary group no longer exists." };
	if (region.groups.length === 1) {
		if (source.tabs.length > 0)
			return { reason: "Move or hide this group's tabs before removing it." };
		const centerId = primaryCenterGroupId(document);
		return {
			document: {
				...document,
				[location.area]: { ...region, visible: false, groups: [] },
			},
			focusGroupId: centerId,
		};
	}
	const targetIndex = sourceIndex > 0 ? sourceIndex - 1 : 1;
	const target = region.groups[targetIndex];
	if (!target) return { reason: "The auxiliary group no longer exists." };
	const groups = region.groups
		.filter((group) => group.id !== source.id)
		.map((group) =>
			group.id === target.id
				? { ...group, weight: group.weight + source.weight, tabs: [...group.tabs, ...source.tabs] }
				: group,
		);
	const total = groups.reduce((sum, group) => sum + group.weight, 0);
	const normalized = groups.map((group) => ({ ...group, weight: group.weight / total }));
	const focusTab = source.tabs[0] ?? target.tabs[0];
	return {
		document: {
			...document,
			[location.area]: { ...region, groups: normalized },
		},
		focusGroupId: target.id,
		...(focusTab ? { focusTabId: focusTab.id } : {}),
	};
}

function replacePlacedCenterTab(
	document: WorkspaceLayoutDocument,
	tabId: string,
	replacement: LayoutCenterTab,
): WorkspaceLayoutDocument {
	const center = mapCenter(document.center, (group) => {
		const index = group.tabs.findIndex((tab) => tab.id === tabId);
		return index < 0 ? group : { ...group, tabs: group.tabs.with(index, replacement) };
	});
	if (replacement.kind !== "terminal") {
		return center === document.center ? document : { ...document, center };
	}
	const replaceInAuxiliary = <T extends LayoutSideRegion | LayoutBottomRegion>(region: T): T => {
		let changed = false;
		const groups = region.groups.map((group) => {
			const index = group.tabs.findIndex((tab) => tab.id === tabId);
			if (index < 0) return group;
			changed = true;
			return { ...group, tabs: group.tabs.with(index, replacement) };
		});
		return changed ? ({ ...region, groups } as T) : region;
	};
	const left = replaceInAuxiliary(document.left);
	const right = replaceInAuxiliary(document.right);
	const bottom = replaceInAuxiliary(document.bottom);
	return center === document.center &&
		left === document.left &&
		right === document.right &&
		bottom === document.bottom
		? document
		: { ...document, center, left, right, bottom };
}

export function findPlacedResource(
	document: WorkspaceLayoutDocument,
	tab: LayoutTab,
): LayoutTab | null {
	const identity = layoutResourceIdentity(tab);
	return (
		collectAllGroups(document)
			.flatMap((group) => group.tabs)
			.find((candidate) => layoutResourceIdentity(candidate) === identity) ?? null
	);
}

export function unplacedTools(document: WorkspaceLayoutDocument): readonly LayoutToolId[] {
	return LAYOUT_TOOLS.filter((tool) => findPlacedResource(document, toolTab(tool)) === null);
}

export function unplacedToolsForSide(
	document: WorkspaceLayoutDocument,
	side: LayoutSide,
): readonly LayoutToolId[] {
	return unplacedTools(document).filter(
		(tool) =>
			(document.toolRestoreTargets[tool]?.region ?? LAYOUT_TOOL_DEFAULT_SIDES[tool]) === side,
	);
}

function resolvePlacedResource(
	document: WorkspaceLayoutDocument,
	tab: LayoutTab,
): { placed: LayoutTab | null; conflictingId: boolean } {
	const identity = layoutResourceIdentity(tab);
	const placed = findPlacedResource(document, tab);
	const exact = findLayoutTab(document, tab.id);
	return {
		placed,
		conflictingId: exact !== null && layoutResourceIdentity(exact) !== identity,
	};
}

export function openCenterTab(
	document: WorkspaceLayoutDocument,
	tab: LayoutCenterTab,
	groupId: string,
	intent: "preview" | "keep",
	claimPreview = false,
): LayoutOperationResult {
	const resolved = resolvePlacedResource(document, tab);
	if (resolved.conflictingId) return { reason: "That tab id belongs to another resource." };
	const previewCompatible = tab.kind === "file" || tab.kind === "diff";
	const effectiveIntent = intent === "preview" && !previewCompatible ? "keep" : intent;
	const existingTab = resolved.placed;
	const existing = existingTab ? findTabLocation(document, existingTab.id) : null;
	if (existing && existingTab) {
		const replacement: LayoutCenterTab = { ...tab, id: existingTab.id };
		const nextDocument =
			existingTab.id === tab.id &&
			existingTab.kind === replacement.kind &&
			layoutResourceIdentity(existingTab) === layoutResourceIdentity(replacement) &&
			JSON.stringify(existingTab) !== JSON.stringify(replacement)
				? replacePlacedCenterTab(document, existingTab.id, replacement)
				: document;
		return effectiveIntent === "keep" && existing.area === "center"
			? keepPreview(nextDocument, existing.groupId, existingTab.id)
			: { document: nextDocument, focusGroupId: existing.groupId, focusTabId: existingTab.id };
	}
	const target = findCenterGroup(document.center, groupId);
	if (!target) return { reason: "The destination group no longer exists." };
	let tabs = target.tabs;
	let previewTabId = target.previewTabId;
	const claimsPreviewSlot = previewCompatible && (effectiveIntent === "preview" || claimPreview);
	if (claimsPreviewSlot && previewTabId) {
		const slot = tabs.findIndex((candidate) => candidate.id === previewTabId);
		if (slot >= 0) tabs = tabs.map((candidate, index) => (index === slot ? tab : candidate));
		else tabs = [...tabs, tab];
	} else {
		tabs = [...tabs, tab];
	}
	if (effectiveIntent === "preview") previewTabId = tab.id;
	else if (previewCompatible && claimPreview) previewTabId = undefined;
	const center = updateCenterGroup(document.center, groupId, (group) =>
		withGroupTabs(group, tabs, previewTabId),
	);
	return { document: { ...document, center }, focusGroupId: groupId, focusTabId: tab.id };
}

export function keepPreview(
	document: WorkspaceLayoutDocument,
	groupId: string,
	tabId: string,
): LayoutOperationResult {
	const group = findCenterGroup(document.center, groupId);
	if (!group || group.previewTabId !== tabId)
		return { document, focusGroupId: groupId, focusTabId: tabId };
	return {
		document: {
			...document,
			center: updateCenterGroup(document.center, groupId, (current) =>
				withGroupTabs(current, current.tabs),
			),
		},
		focusGroupId: groupId,
		focusTabId: tabId,
	};
}

export function closeLayoutTab(
	document: WorkspaceLayoutDocument,
	tabId: string,
): LayoutMutationResult {
	const tab = findLayoutTab(document, tabId);
	const location = findTabLocation(document, tabId);
	if (!tab || !location) return { document };
	if (tab.kind !== "tool" || location.area === "center") {
		return { document: removeTabEverywhere(document, tabId) };
	}
	const group = findAuxiliaryGroup(document, location.area, location.groupId);
	const index = group?.tabs.findIndex((candidate) => candidate.id === tabId) ?? 0;
	return {
		document: {
			...removeTabEverywhere(document, tabId),
			toolRestoreTargets: {
				...document.toolRestoreTargets,
				[tab.tool]: {
					region: location.area,
					groupId: location.groupId,
					index: Math.max(0, index),
				},
			},
		},
	};
}

export function canPlaceLayoutTab(tab: LayoutTab, area: "center" | LayoutAuxiliaryRegion): boolean {
	if (area === "center") return tab.kind !== "tool";
	return tab.kind === "tool" || tab.kind === "terminal";
}

export function moveTabToGroup(
	document: WorkspaceLayoutDocument,
	tab: LayoutTab,
	target: LayoutGroupLocation,
	index?: number,
): LayoutOperationResult {
	const resolved = resolvePlacedResource(document, tab);
	if (resolved.conflictingId) return { reason: "That tab id belongs to another resource." };
	const movingTab = resolved.placed ?? tab;
	if (!canPlaceLayoutTab(movingTab, target.area))
		return { reason: "That tab type cannot move to this region." };
	const source = findTabLocation(document, movingTab.id);
	if (source?.area === target.area && source.groupId === target.groupId) {
		const current =
			target.area === "center"
				? findCenterGroup(document.center, target.groupId)
				: findAuxiliaryGroup(document, target.area, target.groupId);
		if (!current) return { reason: "The destination group no longer exists." };
		const tabs = current.tabs.filter((candidate) => candidate.id !== movingTab.id);
		const insertion = Math.max(0, Math.min(index ?? tabs.length, tabs.length));
		tabs.splice(insertion, 0, movingTab);
		if (current.tabs.every((candidate, position) => candidate.id === tabs[position]?.id)) {
			return { reason: "That tab is already at this position." };
		}
		if (target.area === "center") {
			return {
				document: {
					...document,
					center: updateCenterGroup(
						document.center,
						target.groupId,
						(group) => ({ ...group, tabs }) as LayoutCenterGroup,
					),
				},
				focusGroupId: target.groupId,
				focusTabId: movingTab.id,
			};
		}
		return {
			document: {
				...document,
				[target.area]: {
					...document[target.area],
					groups: document[target.area].groups.map((group) =>
						group.id === target.groupId ? { ...group, tabs: tabs as LayoutSideTab[] } : group,
					),
				},
			},
			focusGroupId: target.groupId,
			focusTabId: movingTab.id,
		};
	}
	const without = removeTabEverywhere(document, movingTab.id);
	if (target.area === "center") {
		const group = findCenterGroup(without.center, target.groupId);
		if (!group || movingTab.kind === "tool")
			return { reason: "The destination group no longer exists." };
		const insertion = Math.max(0, Math.min(index ?? group.tabs.length, group.tabs.length));
		const tabs = [...group.tabs];
		tabs.splice(insertion, 0, movingTab);
		return {
			document: {
				...without,
				center: updateCenterGroup(without.center, group.id, (current) => ({ ...current, tabs })),
			},
			focusGroupId: group.id,
			focusTabId: movingTab.id,
		};
	}
	const groups = without[target.area].groups;
	const groupIndex = groups.findIndex((group) => group.id === target.groupId);
	if (
		groupIndex < 0 ||
		movingTab.kind === "file" ||
		movingTab.kind === "diff" ||
		movingTab.kind === "chat" ||
		movingTab.kind === "document"
	) {
		return { reason: "The destination group no longer exists." };
	}
	const group = groups[groupIndex];
	if (!group) return { reason: "The destination group no longer exists." };
	const insertion = Math.max(0, Math.min(index ?? group.tabs.length, group.tabs.length));
	const tabs = [...group.tabs];
	tabs.splice(insertion, 0, movingTab);
	const nextGroups = groups.map((candidate, candidateIndex) =>
		candidateIndex === groupIndex ? { ...candidate, tabs } : candidate,
	);
	return {
		document: {
			...without,
			[target.area]: { ...without[target.area], visible: true, groups: nextGroups },
		},
		focusGroupId: group.id,
		focusTabId: movingTab.id,
	};
}

export function splitCenterGroup(
	document: WorkspaceLayoutDocument,
	groupId: string,
	direction: CenterSplitDirection,
	tab: LayoutCenterTab,
): LayoutOperationResult {
	if (collectCenterGroups(document.center).length >= LAYOUT_LIMITS.maxCenterGroups) {
		return { reason: `Center groups are limited to ${LAYOUT_LIMITS.maxCenterGroups}.` };
	}
	const source = findCenterGroup(document.center, groupId);
	if (!source) return { reason: "The source group no longer exists." };
	const resolved = resolvePlacedResource(document, tab);
	if (resolved.conflictingId || !resolved.placed || resolved.placed.kind === "tool") {
		return { reason: "Only a placed center-compatible resource can create a split." };
	}
	const placedTab = resolved.placed;
	const newGroup: LayoutCenterGroup = {
		kind: "group",
		id: createLayoutId("center"),
		tabs: [placedTab],
	};
	const sourceLocation = findTabLocation(document, placedTab.id);
	const cleaned =
		sourceLocation?.area === "center" && sourceLocation.groupId === groupId
			? {
					...document,
					center: updateCenterGroup(document.center, groupId, (group) =>
						withGroupTabs(
							group,
							group.tabs.filter((candidate) => candidate.id !== placedTab.id),
							group.previewTabId === placedTab.id ? undefined : group.previewTabId,
						),
					),
					left: removeTabFromSide(document.left, placedTab.id),
					right: removeTabFromSide(document.right, placedTab.id),
					bottom: removeTabFromBottom(document.bottom, placedTab.id),
				}
			: removeTabEverywhere(document, placedTab.id);
	const current = findCenterGroup(cleaned.center, groupId);
	if (!current) return { reason: "The source group no longer exists." };
	const before = direction === "left" || direction === "up";
	const split: LayoutCenterSplit = {
		kind: "split",
		id: createLayoutId("split"),
		direction: direction === "left" || direction === "right" ? "horizontal" : "vertical",
		weights: [0.5, 0.5],
		children: before ? [newGroup, current] : [current, newGroup],
	};
	return {
		document: {
			...cleaned,
			center: replaceCenterGroup(cleaned.center, groupId, split),
		},
		focusGroupId: newGroup.id,
		focusTabId: placedTab.id,
	};
}

export function canCreateAuxiliaryGroup(
	document: WorkspaceLayoutDocument,
	region: LayoutAuxiliaryRegion,
	_tab: LayoutTab,
	maxGroups: number,
	insertAt?: number,
): boolean {
	const currentCount = document[region].groups.length;
	if (currentCount + 1 > Math.max(maxGroups, currentCount)) return false;
	return insertAt === undefined || (insertAt >= 0 && insertAt <= currentCount);
}

export function canCreateSideGroup(
	document: WorkspaceLayoutDocument,
	side: LayoutSide,
	tab: LayoutTab,
	maxGroups: number,
	insertAt?: number,
): boolean {
	return canCreateAuxiliaryGroup(document, side, tab, maxGroups, insertAt);
}

export function createAuxiliaryGroup(
	document: WorkspaceLayoutDocument,
	region: LayoutAuxiliaryRegion,
	tab: LayoutSideTab,
	insertAt: number,
	maxGroups: number,
): LayoutOperationResult {
	const resolved = resolvePlacedResource(document, tab);
	if (resolved.conflictingId) return { reason: "That tab id belongs to another resource." };
	const placedTab = resolved.placed;
	const movingTab = placedTab?.kind === "tool" || placedTab?.kind === "terminal" ? placedTab : tab;
	if (!canCreateAuxiliaryGroup(document, region, movingTab, maxGroups)) {
		return { reason: `This region is limited to ${maxGroups} groups.` };
	}
	if (!canCreateAuxiliaryGroup(document, region, movingTab, maxGroups, insertAt)) {
		return { reason: "That tab is already at this position." };
	}
	const removed = removeTabEverywhere(document, movingTab.id);
	const retained = removed[region].groups;
	const newWeight = 1 / (retained.length + 1);
	const retainedWeight = 1 - newWeight;
	const groups = retained.map((group) => ({
		...group,
		weight: group.weight * retainedWeight,
	}));
	const group: LayoutSideGroup = {
		id: createLayoutId(`${region}-group`),
		weight: newWeight,
		folded: false,
		tabs: [movingTab],
	};
	groups.splice(Math.max(0, Math.min(insertAt, groups.length)), 0, group);
	return {
		document: { ...removed, [region]: { ...removed[region], visible: true, groups } },
		focusGroupId: group.id,
		focusTabId: movingTab.id,
	};
}

export function createSideGroup(
	document: WorkspaceLayoutDocument,
	side: LayoutSide,
	tab: LayoutSideTab,
	insertAt: number,
	maxGroups: number,
): LayoutOperationResult {
	return createAuxiliaryGroup(document, side, tab, insertAt, maxGroups);
}

export function setAuxiliaryGroupFolded(
	document: WorkspaceLayoutDocument,
	region: LayoutAuxiliaryRegion,
	groupId: string,
	folded: boolean,
): LayoutOperationResult {
	if (!document[region].groups.some((group) => group.id === groupId)) {
		return { reason: "The auxiliary group no longer exists." };
	}
	return {
		document: {
			...document,
			[region]: {
				...document[region],
				groups: document[region].groups.map((group) =>
					group.id === groupId ? { ...group, folded } : group,
				),
			},
		},
	};
}

export function setSideGroupFolded(
	document: WorkspaceLayoutDocument,
	side: LayoutSide,
	groupId: string,
	folded: boolean,
): LayoutOperationResult {
	return setAuxiliaryGroupFolded(document, side, groupId, folded);
}

export function setSideVisibility(
	document: WorkspaceLayoutDocument,
	side: LayoutSide,
	visible: boolean,
): WorkspaceLayoutDocument {
	const nextVisible = visible && document[side].groups.length > 0;
	if (document[side].visible === nextVisible) return document;
	return { ...document, [side]: { ...document[side], visible: nextVisible } };
}

export function setBottomVisibility(
	document: WorkspaceLayoutDocument,
	visible: boolean,
): WorkspaceLayoutDocument {
	const nextVisible = visible && document.bottom.groups.length > 0;
	if (document.bottom.visible === nextVisible) return document;
	return { ...document, bottom: { ...document.bottom, visible: nextVisible } };
}

const TOOL_RESTORE_ORDER = LAYOUT_TOOLS;

export function hideSide(
	document: WorkspaceLayoutDocument,
	side: LayoutSide,
	attention: LayoutAttention,
): LayoutMutationResult {
	const center =
		findCenterGroup(document.center, attention.lastFocusedCenterGroupId) ??
		findCenterGroup(document.center, primaryCenterGroupId(document));
	const selected =
		center?.tabs.find((tab) => tab.id === readLayoutSelection(attention, center.id)) ??
		center?.tabs[0];
	return {
		document: setSideVisibility(document, side, false),
		...(center ? { focusGroupId: center.id } : {}),
		...(selected ? { focusTabId: selected.id } : {}),
	};
}

export function hideBottom(
	document: WorkspaceLayoutDocument,
	attention: LayoutAttention,
): LayoutMutationResult {
	const center =
		findCenterGroup(document.center, attention.lastFocusedCenterGroupId) ??
		findCenterGroup(document.center, primaryCenterGroupId(document));
	const selected =
		center?.tabs.find((tab) => tab.id === readLayoutSelection(attention, center.id)) ??
		center?.tabs[0];
	return {
		document: setBottomVisibility(document, false),
		...(center ? { focusGroupId: center.id } : {}),
		...(selected ? { focusTabId: selected.id } : {}),
	};
}

export function canShowSide(document: WorkspaceLayoutDocument, side: LayoutSide): boolean {
	return document[side].groups.length > 0 || unplacedToolsForSide(document, side).length > 0;
}

export function showBottom(
	document: WorkspaceLayoutDocument,
	maxSideGroups: number,
	maxBottomGroups: number,
	attention?: LayoutAttention,
): LayoutOperationResult {
	const populated = document.bottom.groups.some((group) => group.tabs.length > 0);
	if (populated) {
		const shown = setBottomVisibility(document, true);
		const preferredId = attention?.lastFocusedSideGroupId.bottom;
		const group =
			shown.bottom.groups.find((candidate) => candidate.id === preferredId) ??
			shown.bottom.groups.find((candidate) => candidate.tabs.length > 0) ??
			shown.bottom.groups[0];
		if (!group) return { document: shown };
		const selectedId = attention ? readLayoutSelection(attention, group.id) : undefined;
		const tab = group.tabs.find((candidate) => candidate.id === selectedId) ?? group.tabs[0];
		return {
			document: shown,
			focusGroupId: group.id,
			...(tab ? { focusTabId: tab.id } : {}),
		};
	}
	const tool = TOOL_RESTORE_ORDER.find(
		(candidate) =>
			document.toolRestoreTargets[candidate]?.region === "bottom" &&
			!findPlacedResource(document, toolTab(candidate)),
	);
	if (tool) return revealTool(document, tool, maxSideGroups, maxBottomGroups);
	if (document.bottom.groups.length > 0) {
		const shown = setBottomVisibility(document, true);
		const preferredId = attention?.lastFocusedSideGroupId.bottom;
		const group =
			shown.bottom.groups.find((candidate) => candidate.id === preferredId) ??
			shown.bottom.groups[0];
		return { document: shown, ...(group ? { focusGroupId: group.id } : {}) };
	}
	const group: LayoutSideGroup = {
		id: createLayoutId("bottom-group"),
		weight: 1,
		folded: false,
		tabs: [],
	};
	return {
		document: {
			...document,
			bottom: { ...document.bottom, visible: true, groups: [group] },
		},
		focusGroupId: group.id,
	};
}

export function showSide(
	document: WorkspaceLayoutDocument,
	side: LayoutSide,
	maxSideGroups: number,
	attention?: LayoutAttention,
): LayoutOperationResult {
	if (document[side].groups.length > 0) {
		const shown = setSideVisibility(document, side, true);
		const preferredId = attention?.lastFocusedSideGroupId[side];
		const group =
			shown[side].groups.find((candidate) => candidate.id === preferredId) ?? shown[side].groups[0];
		if (!group) return { document: shown };
		const selectedId = attention ? readLayoutSelection(attention, group.id) : undefined;
		const tab = group.tabs.find((candidate) => candidate.id === selectedId) ?? group.tabs[0];
		if (!tab) {
			const restore =
				TOOL_RESTORE_ORDER.find(
					(candidate) =>
						document.toolRestoreTargets[candidate]?.region === side &&
						!findPlacedResource(document, toolTab(candidate)),
				) ??
				TOOL_RESTORE_ORDER.find(
					(candidate) =>
						LAYOUT_TOOL_DEFAULT_SIDES[candidate] === side &&
						!findPlacedResource(document, toolTab(candidate)),
				);
			if (restore) return revealTool(shown, restore, maxSideGroups);
		}
		return {
			document: shown,
			...(tab ? { focusGroupId: group.id, focusTabId: tab.id } : { focusGroupId: group.id }),
		};
	}
	const tool =
		TOOL_RESTORE_ORDER.find(
			(candidate) =>
				document.toolRestoreTargets[candidate]?.region === side &&
				!findPlacedResource(document, toolTab(candidate)),
		) ??
		TOOL_RESTORE_ORDER.find(
			(candidate) =>
				LAYOUT_TOOL_DEFAULT_SIDES[candidate] === side &&
				!findPlacedResource(document, toolTab(candidate)),
		);
	return tool ? revealTool(document, tool, maxSideGroups) : { document };
}

export function revealTool(
	document: WorkspaceLayoutDocument,
	tool: LayoutToolId,
	maxSideGroups: number,
	maxBottomGroups = 3,
): LayoutOperationResult {
	const requestedTab = withAvailablePlacementId(document, toolTab(tool));
	const placedTab = resolvePlacedResource(document, requestedTab).placed;
	const existing = placedTab ? findTabLocation(document, placedTab.id) : null;
	if (placedTab && existing && existing.area !== "center") {
		const region = document[existing.area];
		const group = region.groups.find((candidate) => candidate.id === existing.groupId);
		const changed = !region.visible || group?.folded === true;
		return {
			document: changed
				? {
						...document,
						[existing.area]: {
							...region,
							visible: true,
							groups: region.groups.map((candidate) =>
								candidate.id === existing.groupId ? { ...candidate, folded: false } : candidate,
							),
						},
					}
				: document,
			focusGroupId: existing.groupId,
			focusTabId: placedTab.id,
		};
	}
	const restore = document.toolRestoreTargets[tool];
	const region: LayoutAuxiliaryRegion = restore?.region ?? LAYOUT_TOOL_DEFAULT_SIDES[tool];
	const groups = document[region].groups;
	const restoreGroup = restore?.groupId
		? groups.find((group) => group.id === restore.groupId)
		: undefined;
	if (restoreGroup) {
		const tabs = [...restoreGroup.tabs];
		tabs.splice(Math.max(0, Math.min(restore?.index ?? tabs.length, tabs.length)), 0, requestedTab);
		return {
			document: {
				...document,
				[region]: {
					...document[region],
					visible: true,
					groups: groups.map((group) =>
						group.id === restoreGroup.id ? { ...group, folded: false, tabs } : group,
					),
				},
			},
			focusGroupId: restoreGroup.id,
			focusTabId: requestedTab.id,
		};
	}
	const maxGroups = region === "bottom" ? maxBottomGroups : maxSideGroups;
	if (groups.length > 0 && groups.length >= maxGroups) {
		const group = groups[0];
		if (!group) return { reason: "There is no auxiliary group available for this tool." };
		return moveTabToGroup(
			{
				...document,
				[region]: {
					...document[region],
					visible: true,
					groups: groups.map((candidate) =>
						candidate.id === group.id ? { ...candidate, folded: false } : candidate,
					),
				},
			},
			requestedTab,
			{ area: region, groupId: group.id },
		);
	}
	return createAuxiliaryGroup(document, region, requestedTab, groups.length, maxGroups);
}

export function resizeSideRegion(
	document: WorkspaceLayoutDocument,
	side: LayoutSide,
	width: number,
): WorkspaceLayoutDocument {
	const opposite = side === "left" ? "right" : "left";
	const available = Math.max(Number.MIN_VALUE, 1 - document[opposite].width);
	const gap = Math.min(1e-6, available / 2);
	const upper = Math.max(Number.MIN_VALUE, Math.min(0.7, available - gap));
	const lower = Math.min(0.08, upper);
	const requested = Number.isFinite(width) ? width : document[side].width;
	const normalized = Math.max(lower, Math.min(upper, requested));
	if (Math.abs(normalized - document[side].width) < 1e-9) return document;
	return { ...document, [side]: { ...document[side], width: normalized } };
}

export function resizeBottomRegion(
	document: WorkspaceLayoutDocument,
	height: number,
): WorkspaceLayoutDocument {
	const requested = Number.isFinite(height) ? height : document.bottom.height;
	const normalized = Math.max(Number.MIN_VALUE, Math.min(LAYOUT_LIMITS.maxBottomHeight, requested));
	if (Math.abs(normalized - document.bottom.height) < 1e-9) return document;
	return { ...document, bottom: { ...document.bottom, height: normalized } };
}

export function setBottomAlignment(
	document: WorkspaceLayoutDocument,
	alignment: LayoutBottomAlignment,
): WorkspaceLayoutDocument {
	if (document.bottom.alignment === alignment) return document;
	return { ...document, bottom: { ...document.bottom, alignment } };
}

export function resizeAuxiliaryGroups(
	document: WorkspaceLayoutDocument,
	region: LayoutAuxiliaryRegion,
	weights: readonly number[],
): WorkspaceLayoutDocument {
	const groups = document[region].groups;
	if (weights.length !== groups.length) return document;
	const expanded = groups.flatMap((group, index) => (group.folded ? [] : [index]));
	if (expanded.length === 0) return document;
	const foldedWeight = groups.reduce((sum, group) => sum + (group.folded ? group.weight : 0), 0);
	const availableWeight = Math.max(Number.EPSILON, 1 - foldedWeight);
	const expandedTotal = expanded.reduce((sum, index) => {
		const weight = weights[index];
		return sum + (weight !== undefined && Number.isFinite(weight) && weight > 0 ? weight : 1);
	}, 0);
	const useEqualWeights = !Number.isFinite(expandedTotal) || expandedTotal <= 0;
	const nextGroups = groups.map((group, index) => {
		if (group.folded) return group;
		const weight = weights[index];
		const positive = weight !== undefined && Number.isFinite(weight) && weight > 0 ? weight : 1;
		const nextWeight =
			(useEqualWeights ? 1 / expanded.length : positive / expandedTotal) * availableWeight;
		return Math.abs(nextWeight - group.weight) < 1e-9 ? group : { ...group, weight: nextWeight };
	});
	if (nextGroups.every((group, index) => group === groups[index])) return document;
	return {
		...document,
		[region]: {
			...document[region],
			groups: nextGroups,
		},
	};
}

export function resizeSideGroups(
	document: WorkspaceLayoutDocument,
	side: LayoutSide,
	weights: readonly number[],
): WorkspaceLayoutDocument {
	return resizeAuxiliaryGroups(document, side, weights);
}

export function closePlacedResource(
	document: WorkspaceLayoutDocument,
	tab: LayoutTab,
): LayoutMutationResult {
	const placed = findPlacedResource(document, tab);
	return placed ? closeLayoutTab(document, placed.id) : { document };
}

export function removeSessionLayoutTabs(
	document: WorkspaceLayoutDocument,
	sessionId: string,
): WorkspaceLayoutDocument {
	const ids = collectAllGroups(document)
		.flatMap((group) => group.tabs)
		.filter(
			(tab) =>
				(tab.kind === "chat" && tab.sessionId === sessionId) ||
				(tab.kind === "document" && tab.documentKind === "todo-plan" && tab.sourceId === sessionId),
		)
		.map((tab) => tab.id);
	return ids.reduce(removeTabEverywhere, document);
}

export function resizeCenterSplit(
	document: WorkspaceLayoutDocument,
	splitId: string,
	weights: [number, number],
): WorkspaceLayoutDocument {
	const normalized = normalizeWeights(weights);
	const visit = (node: LayoutCenterNode): LayoutCenterNode => {
		if (node.kind === "group") return node;
		const first = visit(node.children[0]);
		const second = visit(node.children[1]);
		const nextWeights =
			node.id === splitId &&
			(Math.abs(node.weights[0] - normalized[0]) >= 1e-9 ||
				Math.abs(node.weights[1] - normalized[1]) >= 1e-9)
				? normalized
				: node.weights;
		if (first === node.children[0] && second === node.children[1] && nextWeights === node.weights) {
			return node;
		}
		return { ...node, weights: nextWeights, children: [first, second] };
	};
	const center = visit(document.center);
	return center === document.center ? document : { ...document, center };
}

export function reconcileAttention(
	document: WorkspaceLayoutDocument,
	previous: LayoutAttention | undefined,
	previousDocument?: WorkspaceLayoutDocument,
): LayoutAttention {
	const groups = collectAllGroups(document);
	const oldGroups = previousDocument ? collectAllGroups(previousDocument) : [];
	const centerGroups = groups.filter((group) => group.location.area === "center");
	const selectedByGroup = Object.create(null) as Record<string, string>;
	for (const group of groups) {
		const previousId = previous ? readLayoutSelection(previous, group.location.groupId) : undefined;
		const exact = group.tabs.find((tab) => tab.id === previousId);
		const oldGroup = oldGroups.find(
			(candidate) => candidate.location.groupId === group.location.groupId,
		);
		const oldIndex = oldGroup?.tabs.findIndex((tab) => tab.id === previousId) ?? -1;
		const nearest =
			oldIndex >= 0 ? group.tabs[Math.min(oldIndex, group.tabs.length - 1)] : undefined;
		const selected = exact ?? nearest ?? group.tabs[0];
		if (selected) selectedByGroup[group.location.groupId] = selected.id;
	}
	const previousCenter = previous?.lastFocusedCenterGroupId;
	const oldCenterGroups = oldGroups.filter((group) => group.location.area === "center");
	const oldCenterIndex = oldCenterGroups.findIndex(
		(group) => group.location.groupId === previousCenter,
	);
	const center =
		centerGroups.find((group) => group.location.groupId === previousCenter) ??
		(oldCenterIndex >= 0
			? centerGroups[Math.min(oldCenterIndex, centerGroups.length - 1)]
			: centerGroups[0]);
	const lastFocusedSideGroupId = Object.create(null) as Partial<
		Record<LayoutAuxiliaryRegion, string>
	>;
	for (const region of ["left", "right", "bottom"] as const) {
		const auxiliaryGroups = groups.filter((group) => group.location.area === region);
		const previousGroup = previous?.lastFocusedSideGroupId[region];
		const oldAuxiliaryGroups = oldGroups.filter((group) => group.location.area === region);
		const oldGroupIndex = oldAuxiliaryGroups.findIndex(
			(group) => group.location.groupId === previousGroup,
		);
		const group =
			auxiliaryGroups.find((candidate) => candidate.location.groupId === previousGroup) ??
			(oldGroupIndex >= 0
				? auxiliaryGroups[Math.min(oldGroupIndex, auxiliaryGroups.length - 1)]
				: auxiliaryGroups[0]);
		if (group) lastFocusedSideGroupId[region] = group.location.groupId;
	}
	const navigationClockByGroup = Object.assign(
		Object.create(null),
		Object.fromEntries(
			centerGroups.map((group) => [
				group.location.groupId,
				previous ? (readLayoutNavigationClock(previous, group.location.groupId) ?? 0) : 0,
			]),
		),
	) as Record<string, number>;
	return {
		selectedByGroup,
		lastFocusedCenterGroupId: center?.location.groupId ?? primaryCenterGroupId(document),
		lastFocusedSideGroupId,
		navigationClockByGroup,
	};
}

export function selectTab(
	attention: LayoutAttention,
	location: LayoutGroupLocation,
	tabId: string,
	countNavigation = true,
	forceNavigation = false,
): LayoutAttention {
	const alreadySelected = readLayoutSelection(attention, location.groupId) === tabId;
	const alreadyFocused =
		location.area === "center"
			? attention.lastFocusedCenterGroupId === location.groupId
			: attention.lastFocusedSideGroupId[location.area] === location.groupId;
	if (
		alreadySelected &&
		alreadyFocused &&
		!(forceNavigation && countNavigation && location.area === "center")
	) {
		return attention;
	}
	return {
		...attention,
		selectedByGroup: Object.assign(Object.create(null), attention.selectedByGroup, {
			[location.groupId]: tabId,
		}) as Record<string, string>,
		lastFocusedCenterGroupId:
			location.area === "center" ? location.groupId : attention.lastFocusedCenterGroupId,
		lastFocusedSideGroupId:
			location.area === "center"
				? attention.lastFocusedSideGroupId
				: (Object.assign(Object.create(null), attention.lastFocusedSideGroupId, {
						[location.area]: location.groupId,
					}) as Partial<Record<LayoutAuxiliaryRegion, string>>),
		navigationClockByGroup:
			location.area === "center" && countNavigation
				? (Object.assign(Object.create(null), attention.navigationClockByGroup, {
						[location.groupId]: (readLayoutNavigationClock(attention, location.groupId) ?? 0) + 1,
					}) as Record<string, number>)
				: attention.navigationClockByGroup,
	};
}

export function validateLayoutDocument(
	document: WorkspaceLayoutDocument,
	maxSideGroups: number,
	maxBottomGroups = 3,
): string[] {
	const errors: string[] = [];
	if (document.version !== 2) errors.push("Unsupported layout version.");
	const groupIds = new Set<string>();
	const tabIds = new Set<string>();
	const resourceKeys = new Set<string>();
	const toolIds = new Set<LayoutToolId>();
	let tabCount = 0;
	const trackTab = (tab: LayoutTab, area: "center" | LayoutAuxiliaryRegion): void => {
		tabCount += 1;
		if (!canPlaceLayoutTab(tab, area)) errors.push(`Illegal ${area} tab: ${tab.id}`);
		if (tabIds.has(tab.id)) errors.push(`Duplicate tab placement: ${tab.id}`);
		tabIds.add(tab.id);
		const key = layoutResourceIdentity(tab);
		if (resourceKeys.has(key)) errors.push(`Duplicate canonical resource: ${tab.kind}`);
		resourceKeys.add(key);
		if (tab.kind === "tool") {
			if (toolIds.has(tab.tool)) errors.push(`Duplicate singleton tool: ${tab.tool}`);
			toolIds.add(tab.tool);
		}
	};
	const visit = (node: LayoutCenterNode, depth: number): void => {
		if (depth > LAYOUT_LIMITS.maxDepth) errors.push("Center split tree is too deep.");
		if (groupIds.has(node.id)) errors.push(`Duplicate layout node id: ${node.id}`);
		groupIds.add(node.id);
		if (node.kind === "split") {
			if (
				node.weights.some((weight) => !Number.isFinite(weight) || weight <= 0) ||
				Math.abs(node.weights[0] + node.weights[1] - 1) > 1e-6
			) {
				errors.push(`Invalid split weights: ${node.id}`);
			}
			visit(node.children[0], depth + 1);
			visit(node.children[1], depth + 1);
			return;
		}
		for (const tab of node.tabs) trackTab(tab, "center");
		if (node.previewTabId) {
			const preview = node.tabs.find((tab) => tab.id === node.previewTabId);
			if (!preview || (preview.kind !== "file" && preview.kind !== "diff")) {
				errors.push(`Invalid preview resource: ${node.previewTabId}`);
			}
		}
	};
	visit(document.center, 1);
	const centerGroups = collectCenterGroups(document.center);
	if (centerGroups.length > LAYOUT_LIMITS.maxCenterGroups) errors.push("Too many center groups.");
	for (const side of ["left", "right"] as const) {
		const region = document[side];
		if (!Number.isFinite(region.width) || region.width <= 0 || region.width >= 1) {
			errors.push(`Invalid ${side} width.`);
		}
		if (region.groups.length > maxSideGroups) errors.push(`Too many ${side} groups.`);
		if (region.groups.length > LAYOUT_LIMITS.maxSideGroupsSafety) {
			errors.push(`Unsafe ${side} group count.`);
		}
		if (region.visible && region.groups.length === 0) errors.push(`Visible ${side} side is empty.`);
		const weightTotal = region.groups.reduce((sum, group) => sum + group.weight, 0);
		if (region.groups.length > 0 && Math.abs(weightTotal - 1) > 1e-6) {
			errors.push(`Invalid normalized ${side} group weights.`);
		}
		for (const group of region.groups) {
			if (groupIds.has(group.id)) errors.push(`Duplicate group id: ${group.id}`);
			groupIds.add(group.id);
			if (!Number.isFinite(group.weight) || group.weight <= 0)
				errors.push(`Invalid group weight: ${group.id}`);
			for (const tab of group.tabs) trackTab(tab, side);
		}
	}
	const bottom = document.bottom;
	if (
		!Number.isFinite(bottom.height) ||
		bottom.height <= 0 ||
		bottom.height > LAYOUT_LIMITS.maxBottomHeight
	) {
		errors.push("Invalid bottom height.");
	}
	if (
		bottom.alignment !== "center" &&
		bottom.alignment !== "center-left" &&
		bottom.alignment !== "center-right" &&
		bottom.alignment !== "full"
	) {
		errors.push("Invalid bottom alignment.");
	}
	if (bottom.visible && bottom.groups.length === 0) {
		errors.push("Visible bottom region requires a group.");
	}
	if (bottom.groups.length > maxBottomGroups) errors.push("Too many bottom groups.");
	if (bottom.groups.length > LAYOUT_LIMITS.maxSideGroupsSafety) {
		errors.push("Unsafe bottom group count.");
	}
	const bottomWeightTotal = bottom.groups.reduce((sum, group) => sum + group.weight, 0);
	if (bottom.groups.length > 0 && Math.abs(bottomWeightTotal - 1) > 1e-6) {
		errors.push("Invalid normalized bottom group weights.");
	}
	for (const group of bottom.groups) {
		if (groupIds.has(group.id)) errors.push(`Duplicate group id: ${group.id}`);
		groupIds.add(group.id);
		if (!Number.isFinite(group.weight) || group.weight <= 0) {
			errors.push(`Invalid group weight: ${group.id}`);
		}
		for (const tab of group.tabs) trackTab(tab, "bottom");
	}
	if (document.left.width + document.right.width >= 1) {
		errors.push("Side widths leave no center region.");
	}
	if (tabCount > LAYOUT_LIMITS.maxTabs) errors.push("Too many layout tabs.");
	return errors;
}
