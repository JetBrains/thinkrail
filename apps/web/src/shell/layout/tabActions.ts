import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import { copyText, joinWorkspacePath, type LayoutAttention, readLayoutSelection } from "../../lib";
import {
	type CenterSplitDirection,
	type ChatFirstPrompts,
	canCreateAuxiliaryGroup,
	canJoinAuxiliaryGroup,
	collectAllGroups,
	collectCenterGroups,
	createAuxiliaryGroup,
	describeLayoutGroup,
	findAuxiliaryGroup,
	findCenterGroup,
	isLayoutUnavailable,
	LAYOUT_LIMITS,
	type LayoutGroupLocation,
	type LayoutMutationResult,
	type LayoutOperationResult,
	layoutTabName,
	moveTabToGroup,
	removeLayoutGroup,
	separatePanesReason,
	setAuxiliaryGroupFolded,
	splitCenterGroup,
	toolTab,
	unplacedTools,
} from "./model";
import type {
	LayoutAuxiliaryRegion,
	LayoutTab,
	LayoutToolId,
	WorkspaceLayoutDocument,
} from "./types";

export interface CenterSplitGeometry {
	readonly horizontal: boolean;
	readonly vertical: boolean;
}

export type TabActionSection =
	| "tab"
	| "copy"
	| "split"
	| "move"
	| "newGroup"
	| "regionGroup"
	| "tools"
	| "group";

export type TabActionEffect =
	| { readonly kind: "apply"; readonly result: () => LayoutOperationResult }
	| { readonly kind: "select"; readonly keep: boolean }
	| { readonly kind: "rename" }
	| { readonly kind: "focusGroup"; readonly delta: -1 | 1 }
	| { readonly kind: "copy"; readonly text: string }
	| { readonly kind: "revealFile"; readonly path: string }
	| { readonly kind: "hide"; readonly region: LayoutAuxiliaryRegion }
	| { readonly kind: "revealTool"; readonly tool: LayoutToolId }
	| { readonly kind: "close" };

export interface TabAction {
	readonly id: string;
	readonly section: TabActionSection;
	readonly surface: "menu" | "palette" | "both";
	readonly label: string;
	readonly unavailable?: { readonly label: string; readonly reason?: string };
	readonly destructive?: true;
	readonly testId?: string;
	readonly effect: TabActionEffect;
}

export interface FileTabReveal {
	readonly label: string;
	readonly unavailableReason?: string | undefined;
	readonly run: (path: string) => void;
}

export interface TabActionContext {
	readonly document: WorkspaceLayoutDocument;
	readonly tab: LayoutTab;
	readonly location: LayoutGroupLocation;
	readonly preview: boolean;
	readonly reorder: { readonly previous: number | undefined; readonly next: number | undefined };
	readonly maxSideGroups: number;
	readonly maxBottomGroups: number;
	readonly splitGeometry?: CenterSplitGeometry | undefined;
	readonly canFocusAdjacentGroup: boolean;
	readonly canRenameChat: boolean;
	readonly worktreePath: string;
	readonly fileReveal?: Pick<FileTabReveal, "label" | "unavailableReason"> | undefined;
	readonly chatFirstPrompts?: ChatFirstPrompts | undefined;
}

export interface TabActionHandlers {
	readonly apply: (result: LayoutMutationResult) => void;
	readonly select: (keep: boolean) => void;
	readonly rename: () => void;
	readonly focusGroup: (delta: -1 | 1) => void;
	readonly hide: (region: LayoutAuxiliaryRegion) => void;
	readonly revealTool: (tool: LayoutToolId) => void;
	readonly revealFile?: FileTabReveal["run"] | undefined;
	readonly close: () => void;
}

export interface WorkbenchTabCommands {
	readonly list: (groupId: string | undefined) => readonly TabAction[];
	readonly run: (groupId: string | undefined, actionId: string) => void;
}

const MOVE_TO_PANE_LABELS = {
	center: "workbench.tab.moveToCenterPane",
	left: "workbench.tab.moveToLeftPane",
	right: "workbench.tab.moveToRightPane",
	bottom: "workbench.tab.moveToBottomPane",
} as const satisfies Record<LayoutGroupLocation["area"], MessageKey>;

const NEW_REGION_GROUP_LABELS = {
	left: { start: "workbench.tab.newLeftGroupTop", end: "workbench.tab.newLeftGroupBottom" },
	right: { start: "workbench.tab.newRightGroupTop", end: "workbench.tab.newRightGroupBottom" },
	bottom: { start: "workbench.tab.newBottomGroupLeft", end: "workbench.tab.newBottomGroupRight" },
} as const satisfies Record<LayoutAuxiliaryRegion, Record<"start" | "end", MessageKey>>;

const SPLIT_LABELS = {
	left: "workbench.center.splitLeft",
	right: "workbench.center.splitRight",
	up: "workbench.center.splitUp",
	down: "workbench.center.splitDown",
} as const satisfies Record<CenterSplitDirection, MessageKey>;

const SPLIT_IDS = {
	left: "group.splitLeft",
	right: "group.splitRight",
	up: "group.splitUp",
	down: "group.splitDown",
} as const satisfies Record<CenterSplitDirection, string>;

const REORDER_LABELS = {
	horizontal: {
		previous: { label: "workbench.tab.moveLeft", edge: "workbench.tab.moveLeftFirst" },
		next: { label: "workbench.tab.moveRight", edge: "workbench.tab.moveRightLast" },
	},
	vertical: {
		previous: { label: "workbench.tab.moveUp", edge: "workbench.tab.moveUpFirst" },
		next: { label: "workbench.tab.moveDown", edge: "workbench.tab.moveDownLast" },
	},
} as const satisfies Record<
	"horizontal" | "vertical",
	Record<"previous" | "next", Record<"label" | "edge", MessageKey>>
>;

const HIDE_LABELS = {
	left: "workbench.tab.hideLeftSide",
	right: "workbench.tab.hideRightSide",
	bottom: "workbench.bottom.hide",
} as const satisfies Record<LayoutAuxiliaryRegion, MessageKey>;

export function centerSplitGeometry(size: {
	readonly width: number;
	readonly height: number;
}): CenterSplitGeometry {
	return {
		horizontal: size.width >= LAYOUT_LIMITS.minCenterWidth * 2,
		vertical: size.height >= LAYOUT_LIMITS.minCenterHeight * 2,
	};
}

function unavailableAs(t: Translator, label: string, reason: string) {
	return { label: t("workbench.menu.unavailable", { label, reason }), reason };
}

export function adjacentTabGroup(
	document: WorkspaceLayoutDocument,
	tab: LayoutTab,
	location: LayoutGroupLocation,
	delta: -1 | 1,
): LayoutGroupLocation | null {
	if (location.area === "center") {
		const groups = collectCenterGroups(document.center);
		const index = groups.findIndex((group) => group.id === location.groupId);
		const target = index < 0 ? undefined : groups[index + delta];
		return target ? { area: "center", groupId: target.id } : null;
	}
	const groups = document[location.area].groups;
	const index = groups.findIndex((group) => group.id === location.groupId);
	if (index < 0) return null;
	for (let position = index + delta; position >= 0 && position < groups.length; position += delta) {
		const group = groups[position];
		if (group && canJoinAuxiliaryGroup(group, tab)) {
			return { area: location.area, groupId: group.id };
		}
	}
	return null;
}

function moveIntoView(
	document: WorkspaceLayoutDocument,
	tab: LayoutTab,
	target: LayoutGroupLocation,
): LayoutOperationResult {
	const moved = moveTabToGroup(document, tab, target);
	if (
		isLayoutUnavailable(moved) ||
		target.area === "center" ||
		!findAuxiliaryGroup(moved.document, target.area, target.groupId)?.folded
	) {
		return moved;
	}
	const unfolded = setAuxiliaryGroupFolded(moved.document, target.area, target.groupId, false);
	return isLayoutUnavailable(unfolded) ? moved : { ...moved, document: unfolded.document };
}

function primaryActions(t: Translator, context: TabActionContext): TabAction[] {
	const { tab, location, preview, reorder } = context;
	const vertical = tab.kind === "tool" && location.area !== "bottom";
	const actions: TabAction[] = [
		{
			id: "tab.focus",
			section: "tab",
			surface: "menu",
			label: t("workbench.tab.focus"),
			effect: { kind: "select", keep: false },
		},
	];
	if (tab.kind === "chat" && context.canRenameChat) {
		actions.push({
			id: "tab.renameChat",
			section: "tab",
			surface: "both",
			label: t("workbench.tab.renameChat"),
			effect: { kind: "rename" },
		});
	}
	actions.push(
		{
			id: "group.focusPrevious",
			section: "tab",
			surface: "both",
			label: t("workbench.tab.focusPreviousGroup"),
			...(context.canFocusAdjacentGroup
				? {}
				: { unavailable: { label: t("workbench.tab.focusPreviousGroupUnavailable") } }),
			effect: { kind: "focusGroup", delta: -1 },
		},
		{
			id: "group.focusNext",
			section: "tab",
			surface: "both",
			label: t("workbench.tab.focusNextGroup"),
			...(context.canFocusAdjacentGroup
				? {}
				: { unavailable: { label: t("workbench.tab.focusNextGroupUnavailable") } }),
			effect: { kind: "focusGroup", delta: 1 },
		},
	);
	if (location.area === "center") {
		actions.push({
			id: "tab.keepPreview",
			section: "tab",
			surface: "both",
			label: t("workbench.tab.keepPreview"),
			...(preview ? {} : { unavailable: { label: t("workbench.tab.keepPreviewUnavailable") } }),
			effect: { kind: "select", keep: true },
		});
	}
	const orientation = vertical ? "vertical" : "horizontal";
	for (const side of ["previous", "next"] as const) {
		const index = reorder[side];
		const { label, edge } = REORDER_LABELS[orientation][side];
		actions.push({
			id: side === "previous" ? "tab.reorderPrevious" : "tab.reorderNext",
			section: "tab",
			surface: "menu",
			label: t(label),
			...(index === undefined ? { unavailable: { label: t(edge) } } : {}),
			effect: {
				kind: "apply",
				result: () =>
					index === undefined
						? { reason: t(edge) }
						: moveTabToGroup(context.document, tab, location, index),
			},
		});
	}
	return actions;
}

function fileActions(
	t: Translator,
	{ tab, worktreePath, fileReveal }: TabActionContext,
): TabAction[] {
	if (tab.kind !== "file" && tab.kind !== "diff") return [];
	const actions: TabAction[] = [
		{
			id: "tab.copyPath",
			section: "copy",
			surface: "both",
			label: t("workbench.tab.copyPath"),
			testId: "tab-copy-path",
			effect: { kind: "copy", text: joinWorkspacePath(worktreePath, tab.path) },
		},
		{
			id: "tab.copyRelativePath",
			section: "copy",
			surface: "both",
			label: t("workbench.tab.copyRelativePath"),
			testId: "tab-copy-relative-path",
			effect: { kind: "copy", text: tab.path },
		},
	];
	if (fileReveal) {
		const { label, unavailableReason } = fileReveal;
		actions.push({
			id: "tab.revealFile",
			section: "copy",
			surface: "both",
			label,
			testId: "file-reveal",
			...(unavailableReason !== undefined
				? { unavailable: { label, reason: unavailableReason } }
				: {}),
			effect: { kind: "revealFile", path: tab.path },
		});
	}
	return actions;
}

function splitActions(t: Translator, context: TabActionContext): TabAction[] {
	const { document, tab, location, splitGeometry } = context;
	if (location.area !== "center" || tab.kind === "tool") return [];
	const atLimit = collectCenterGroups(document.center).length >= LAYOUT_LIMITS.maxCenterGroups;
	return (["left", "right", "up", "down"] as const).map((direction): TabAction => {
		const label = t(SPLIT_LABELS[direction]);
		const horizontal = direction === "left" || direction === "right";
		const reason = atLimit
			? t("workbench.layout.centerGroupLimit", { limit: LAYOUT_LIMITS.maxCenterGroups })
			: splitGeometry && !(horizontal ? splitGeometry.horizontal : splitGeometry.vertical)
				? horizontal
					? t("workbench.tab.splitNeedsWidth", { size: LAYOUT_LIMITS.minCenterWidth * 2 })
					: t("workbench.tab.splitNeedsHeight", { size: LAYOUT_LIMITS.minCenterHeight * 2 })
				: null;
		return {
			id: SPLIT_IDS[direction],
			section: "split",
			surface: "both",
			label,
			...(reason === null ? {} : { unavailable: unavailableAs(t, label, reason) }),
			effect: {
				kind: "apply",
				result: () => splitCenterGroup(document, location.groupId, direction, tab),
			},
		};
	});
}

function moveActions(t: Translator, context: TabActionContext): TabAction[] {
	const { document, tab, location, chatFirstPrompts } = context;
	const actions: TabAction[] = [];
	for (const delta of [-1, 1] as const) {
		const target = adjacentTabGroup(document, tab, location, delta);
		if (!target) continue;
		actions.push({
			id: delta < 0 ? "tab.moveToPreviousGroup" : "tab.moveToNextGroup",
			section: "move",
			surface: "palette",
			label: t(delta < 0 ? "workbench.tab.moveToPreviousGroup" : "workbench.tab.moveToNextGroup"),
			effect: { kind: "apply", result: () => moveIntoView(document, tab, target) },
		});
	}
	for (const group of collectAllGroups(document)) {
		const target = group.location;
		if (target.groupId === location.groupId) continue;
		const allowed =
			tab.kind === "terminal" || target.area === "center"
				? tab.kind !== "tool"
				: tab.kind === "tool";
		if (!allowed) continue;
		const label = t(MOVE_TO_PANE_LABELS[target.area], {
			group: describeLayoutGroup(t, group.tabs, chatFirstPrompts),
		});
		const separate = target.area !== "center" && !canJoinAuxiliaryGroup(group, tab);
		actions.push({
			id: `tab.moveTo.${target.groupId}`,
			section: "move",
			surface: "both",
			label,
			...(separate ? { unavailable: unavailableAs(t, label, separatePanesReason(t)) } : {}),
			effect: { kind: "apply", result: () => moveTabToGroup(document, tab, target) },
		});
	}
	return actions;
}

function newGroupActions(t: Translator, context: TabActionContext): TabAction[] {
	const { document, tab, location, maxSideGroups, maxBottomGroups } = context;
	if (tab.kind !== "terminal" && tab.kind !== "tool") return [];
	const limitOf = (region: LayoutAuxiliaryRegion) =>
		region === "bottom" ? maxBottomGroups : maxSideGroups;
	const create = (region: LayoutAuxiliaryRegion, insertAt: number) => () =>
		createAuxiliaryGroup(document, region, tab, insertAt, limitOf(region));
	const actions: TabAction[] = [];
	const current = location.area === "center" ? null : location.area;
	const currentIndex = current
		? document[current].groups.findIndex((group) => group.id === location.groupId)
		: -1;
	if (current && currentIndex >= 0) {
		const limit = limitOf(current);
		const countAvailable = canCreateAuxiliaryGroup(document, current, tab, limit);
		for (const position of ["before", "after"] as const) {
			const insertAt = currentIndex + (position === "after" ? 1 : 0);
			const label =
				current === "bottom"
					? t(position === "before" ? "workbench.tab.newGroupLeft" : "workbench.tab.newGroupRight")
					: t(
							position === "before" ? "workbench.tab.newGroupAbove" : "workbench.tab.newGroupBelow",
						);
			const available = canCreateAuxiliaryGroup(document, current, tab, limit, insertAt);
			const reason = countAvailable
				? t("workbench.tab.alreadyAtPosition")
				: t("workbench.tab.limitedTo", { limit });
			actions.push({
				id: position === "before" ? "tab.newGroupBefore" : "tab.newGroupAfter",
				section: "newGroup",
				surface: "both",
				label,
				...(available ? {} : { unavailable: unavailableAs(t, label, reason) }),
				effect: { kind: "apply", result: create(current, insertAt) },
			});
		}
	}
	for (const region of ["left", "right", "bottom"] as const) {
		const limit = limitOf(region);
		const countAvailable = canCreateAuxiliaryGroup(document, region, tab, limit);
		for (const edge of ["start", "end"] as const) {
			const insertAt = edge === "start" ? 0 : document[region].groups.length;
			const label = t(NEW_REGION_GROUP_LABELS[region][edge]);
			const available = canCreateAuxiliaryGroup(document, region, tab, limit, insertAt);
			const reason = countAvailable
				? t(edge === "start" ? "workbench.tab.alreadyAtStart" : "workbench.tab.alreadyAtEnd")
				: t("workbench.tab.limitedTo", { limit });
			actions.push({
				id: `tab.newGroup.${region}.${edge}`,
				section: "regionGroup",
				surface: "both",
				label,
				...(available ? {} : { unavailable: unavailableAs(t, label, reason) }),
				effect: { kind: "apply", result: create(region, insertAt) },
			});
		}
	}
	return actions;
}

function groupActions(t: Translator, context: TabActionContext): TabAction[] {
	const { document, tab, location } = context;
	const actions: TabAction[] = [];
	if (location.area !== "center") {
		for (const tool of unplacedTools(document)) {
			actions.push({
				id: `tab.showTool.${tool}`,
				section: "tools",
				surface: "menu",
				label: t("workbench.tab.showTool", { name: layoutTabName(t, toolTab(tool)) }),
				effect: { kind: "revealTool", tool },
			});
		}
		actions.push({
			id: "group.hide",
			section: "group",
			surface: "both",
			label: t(HIDE_LABELS[location.area]),
			effect: { kind: "hide", region: location.area },
		});
	}
	const removal = removeLayoutGroup(t, document, location);
	const removeLabel = t("workbench.group.remove");
	actions.push(
		{
			id: "group.remove",
			section: "group",
			surface: "both",
			label: removeLabel,
			...(isLayoutUnavailable(removal)
				? { unavailable: unavailableAs(t, removeLabel, removal.reason) }
				: {}),
			effect: { kind: "apply", result: () => removal },
		},
		tab.kind === "tool"
			? {
					id: "tab.removeTool",
					section: "group",
					surface: "menu",
					label: t("workbench.tab.removeToolFromGroup"),
					destructive: true,
					effect: { kind: "close" },
				}
			: {
					id: "tab.close",
					section: "group",
					surface: "both",
					label: t("common.close"),
					destructive: true,
					effect: { kind: "close" },
				},
	);
	return actions;
}

export function tabActions(t: Translator, context: TabActionContext): TabAction[] {
	return [
		...primaryActions(t, context),
		...fileActions(t, context),
		...splitActions(t, context),
		...moveActions(t, context),
		...newGroupActions(t, context),
		...groupActions(t, context),
	];
}

export function performTabAction(action: TabAction, handlers: TabActionHandlers): void {
	const { effect } = action;
	switch (effect.kind) {
		case "apply": {
			const result = effect.result();
			if (!isLayoutUnavailable(result)) handlers.apply(result);
			return;
		}
		case "select":
			handlers.select(effect.keep);
			return;
		case "rename":
			handlers.rename();
			return;
		case "focusGroup":
			handlers.focusGroup(effect.delta);
			return;
		case "copy":
			void copyText(effect.text);
			return;
		case "revealFile":
			handlers.revealFile?.(effect.path);
			return;
		case "hide":
			handlers.hide(effect.region);
			return;
		case "revealTool":
			handlers.revealTool(effect.tool);
			return;
		case "close":
			handlers.close();
			return;
	}
}

export interface TabActionTarget {
	readonly tab: LayoutTab;
	readonly location: LayoutGroupLocation;
	readonly index: number;
	readonly count: number;
	readonly preview: boolean;
}

export function tabActionTarget(
	document: WorkspaceLayoutDocument,
	attention: LayoutAttention,
	groupId: string | undefined,
): TabActionTarget | null {
	const id = groupId ?? attention.lastFocusedCenterGroupId;
	const group = collectAllGroups(document).find((candidate) => candidate.location.groupId === id);
	if (!group || group.folded) return null;
	const { location } = group;
	if (location.area !== "center" && !document[location.area].visible) return null;
	const selectedId = readLayoutSelection(attention, id);
	const index = Math.max(
		0,
		group.tabs.findIndex((candidate) => candidate.id === selectedId),
	);
	const tab = group.tabs[index];
	if (!tab) return null;
	return {
		tab,
		location,
		index,
		count: group.tabs.length,
		preview:
			location.area === "center" &&
			findCenterGroup(document.center, location.groupId)?.previewTabId === tab.id,
	};
}
