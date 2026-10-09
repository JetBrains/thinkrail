import { type LayoutAttention, readLayoutSelection, tupleKey } from "../../lib";
import {
	findAuxiliaryGroup,
	findPlacedResource,
	findTabLocation,
	isLayoutUnavailable,
	type LayoutOperationResult,
	resizeAuxiliaryGroups,
	revealTool,
	setAuxiliaryGroupFolded,
	setBottomVisibility,
	setSideVisibility,
	showBottom,
	toolTab,
	unplacedToolsForRegion,
} from "./model";
import type {
	LayoutAuxiliaryRegion,
	LayoutSideGroup,
	LayoutTab,
	LayoutTerminalTab,
	LayoutToolId,
	LayoutToolTab,
	WorkspaceLayoutDocument,
} from "./types";

type RailEntryBase = {
	key: string;
	region: LayoutAuxiliaryRegion;
	selected: boolean;
	expanded: boolean;
};

export type AuxiliaryRailEntry = RailEntryBase &
	(
		| { kind: "tool"; groupId: string | null; tool: LayoutToolId; tab: LayoutToolTab | null }
		| {
				kind: "terminals";
				groupId: string;
				tabs: readonly LayoutTerminalTab[];
				selectedTerminalId: string | null;
		  }
		| { kind: "empty"; groupId: string | null }
	);

export type AuxiliaryRailToolEntry = Extract<AuxiliaryRailEntry, { kind: "tool" }>;

export interface AuxiliaryRailCluster {
	key: string;
	groupId: string | null;
	entries: AuxiliaryRailEntry[];
}

export function isUnplacedRailEntry(entry: AuxiliaryRailEntry): boolean {
	return entry.kind === "tool" ? entry.tab === null : entry.kind === "empty" && !entry.groupId;
}

export function clusterAuxiliaryRail(
	entries: readonly AuxiliaryRailEntry[],
): readonly AuxiliaryRailCluster[] {
	const clusters: AuxiliaryRailCluster[] = [];
	for (const entry of entries) {
		const groupId = isUnplacedRailEntry(entry) ? null : entry.groupId;
		const last = clusters.at(-1);
		if (last && last.groupId === groupId) last.entries.push(entry);
		else clusters.push({ key: groupId ?? "unplaced", groupId, entries: [entry] });
	}
	return clusters;
}

export function visibleAuxiliaryGroups(
	document: WorkspaceLayoutDocument,
	region: LayoutAuxiliaryRegion,
): { group: LayoutSideGroup; documentIndex: number; size: number }[] {
	const visible = document[region].groups.flatMap((group, documentIndex) =>
		group.folded ? [] : [{ group, documentIndex }],
	);
	const total = visible.reduce((sum, { group }) => sum + group.weight, 0);
	return visible.map(({ group, documentIndex }) => ({
		group,
		documentIndex,
		size: total > 0 ? (group.weight / total) * 100 : 100 / visible.length,
	}));
}

export function resizeVisibleAuxiliaryGroups(
	document: WorkspaceLayoutDocument,
	region: LayoutAuxiliaryRegion,
	sizes: readonly number[],
): WorkspaceLayoutDocument {
	const visible = visibleAuxiliaryGroups(document, region);
	if (visible.length !== sizes.length) return document;
	const weights = document[region].groups.map(
		(group, index) =>
			sizes[visible.findIndex((entry) => entry.documentIndex === index)] ?? group.weight,
	);
	return resizeAuxiliaryGroups(document, region, weights);
}

export function projectWorkbenchRatio(ratio: number, whole: number, available: number): number {
	return whole > 0 && available > 0 ? (ratio * whole) / available : ratio;
}
export function restoreWorkbenchRatio(ratio: number, whole: number, available: number): number {
	return whole > 0 && available > 0 ? (ratio * available) / whole : ratio;
}

function selectedTab(group: LayoutSideGroup, attention: LayoutAttention): LayoutTab | undefined {
	return (
		group.tabs.find((tab) => tab.id === readLayoutSelection(attention, group.id)) ?? group.tabs[0]
	);
}

function preferredTerminal(
	group: LayoutSideGroup,
	attention: LayoutAttention,
): LayoutTerminalTab | undefined {
	const current = selectedTab(group, attention);
	if (current?.kind === "terminal") return current;
	return group.tabs.find((tab): tab is LayoutTerminalTab => tab.kind === "terminal");
}

export function projectAuxiliaryRail(
	document: WorkspaceLayoutDocument,
	attention: LayoutAttention,
	region: LayoutAuxiliaryRegion,
): readonly AuxiliaryRailEntry[] {
	const entries: AuxiliaryRailEntry[] = [];
	for (const group of document[region].groups) {
		const selected = selectedTab(group, attention);
		const expanded = document[region].visible && !group.folded;
		const terminals = group.tabs.filter((tab): tab is LayoutTerminalTab => tab.kind === "terminal");
		let terminalEntryAdded = false;
		for (const tab of group.tabs) {
			if (tab.kind === "tool") {
				entries.push({
					kind: "tool",
					key: tupleKey("rail-tool", region, tab.tool),
					region,
					groupId: group.id,
					tool: tab.tool,
					tab,
					selected: selected?.id === tab.id,
					expanded,
				});
			} else if (!terminalEntryAdded) {
				terminalEntryAdded = true;
				entries.push({
					kind: "terminals",
					key: tupleKey("rail-terminals", region, group.id),
					region,
					groupId: group.id,
					tabs: terminals,
					selectedTerminalId: preferredTerminal(group, attention)?.id ?? null,
					selected: selected?.kind === "terminal",
					expanded,
				});
			}
		}
		if (group.tabs.length === 0)
			entries.push({
				kind: "empty",
				key: tupleKey("rail-empty", region, group.id),
				region,
				groupId: group.id,
				selected: true,
				expanded,
			});
	}
	for (const tool of unplacedToolsForRegion(document, region)) {
		entries.push({
			kind: "tool",
			key: tupleKey("rail-tool", region, tool),
			region,
			groupId: document.toolRestoreTargets[tool]?.groupId ?? null,
			tool,
			tab: null,
			selected: false,
			expanded: false,
		});
	}
	if (region === "bottom" && document.bottom.groups.length === 0)
		entries.push({
			kind: "empty",
			key: tupleKey("rail-empty", region, "unplaced"),
			region,
			groupId: null,
			selected: false,
			expanded: false,
		});
	return entries;
}

function activateGroup(
	document: WorkspaceLayoutDocument,
	region: LayoutAuxiliaryRegion,
	group: LayoutSideGroup,
	tab: LayoutTab | undefined,
	hide: boolean,
): LayoutOperationResult {
	const visible =
		region === "bottom"
			? setBottomVisibility(document, true)
			: setSideVisibility(document, region, true);
	const result =
		group.folded === hide
			? { document: visible }
			: setAuxiliaryGroupFolded(visible, region, group.id, hide);
	if (isLayoutUnavailable(result)) return result;
	return { ...result, focusGroupId: group.id, ...(!hide && tab ? { focusTabId: tab.id } : {}) };
}

export function activateAuxiliaryRailEntry(
	document: WorkspaceLayoutDocument,
	attention: LayoutAttention,
	entry: AuxiliaryRailEntry,
	maxSideGroups: number,
	maxBottomGroups: number,
): LayoutOperationResult {
	if (entry.kind === "tool") {
		const placed = findPlacedResource(document, toolTab(entry.tool));
		if (!placed) return revealTool(document, entry.tool, maxSideGroups, maxBottomGroups);
		const location = findTabLocation(document, placed.id);
		if (!location || location.area === "center")
			return { reason: "The tool window is unavailable." };
		const group = findAuxiliaryGroup(document, location.area, location.groupId);
		if (!group) return { reason: "The tool window is unavailable." };
		return activateGroup(
			document,
			location.area,
			group,
			placed,
			document[location.area].visible &&
				!group.folded &&
				selectedTab(group, attention)?.id === placed.id,
		);
	}
	if (!entry.groupId) {
		return entry.region === "bottom"
			? showBottom(document, maxSideGroups, maxBottomGroups, attention)
			: { reason: "The tool window is unavailable." };
	}
	const group = findAuxiliaryGroup(document, entry.region, entry.groupId);
	if (!group) return { reason: "The tool window no longer exists." };
	const current = selectedTab(group, attention);
	const tab = entry.kind === "terminals" ? preferredTerminal(group, attention) : current;
	if (entry.kind === "terminals" && !tab)
		return { reason: "This pane no longer contains terminals." };
	const hide =
		document[entry.region].visible &&
		!group.folded &&
		(entry.kind === "terminals" ? current?.kind === "terminal" : group.tabs.length === 0);
	return activateGroup(document, entry.region, group, tab, hide);
}
