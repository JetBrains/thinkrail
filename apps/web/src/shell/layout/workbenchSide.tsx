import { useDroppable } from "@dnd-kit/core";
import {
	RiLayoutLeftLine as PanelLeftOpen,
	RiLayoutRightLine as PanelRightOpen,
	RiAddLine as Plus,
	RiCollapseVerticalLine,
	RiExpandVerticalLine,
	RiCloseLine as X,
} from "@remixicon/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { memo } from "react";
import { type LayoutAttention, readLayoutSelection, tupleKey } from "../../lib";
import {
	canCreateSideGroup,
	canPlaceLayoutTab,
	isLayoutUnavailable,
	LAYOUT_LIMITS,
	type LayoutGroupLocation,
	type LayoutSide,
	removeLayoutGroup,
	resizeSideGroups,
	setSideGroupFolded,
	toolTab,
	unplacedToolsForSide,
} from "./model";
import type { LayoutSideGroup, LayoutToolId, WorkspaceLayoutDocument } from "./types";
import type { DropTarget, SharedGroupProps, WorkbenchProps } from "./workbenchShared";
import {
	DropZone,
	GroupTabBody,
	groupPanelId,
	PanelWithHandle,
	tabDomId,
	useCommittedSizes,
	useElementSize,
} from "./workbenchShared";
import { TabStrip } from "./workbenchTabs";
export const SideGroupView = memo(function SideGroupView({
	side,
	group,
	groupIndex,
	foldable,
	selectedId,
	renderToolBody,
	onFold,
	...shared
}: SharedGroupProps & {
	side: LayoutSide;
	group: LayoutSideGroup;
	groupIndex: number;
	foldable: boolean;
	selectedId: string | undefined;
	renderToolBody: WorkbenchProps["renderToolBody"];
	onFold: () => void;
}) {
	const location: LayoutGroupLocation = { area: side, groupId: group.id };
	const groupRemoval = removeLayoutGroup(shared.document, location);
	const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
	const draggedSideTab =
		shared.draggingTab?.kind === "tool" || shared.draggingTab?.kind === "terminal"
			? shared.draggingTab
			: null;
	const canCreateAbove = Boolean(
		draggedSideTab &&
			canPlaceLayoutTab(draggedSideTab, side) &&
			canCreateSideGroup(shared.document, side, draggedSideTab, shared.maxSideGroups, groupIndex),
	);
	const canCreateBelow = Boolean(
		draggedSideTab &&
			canPlaceLayoutTab(draggedSideTab, side) &&
			canCreateSideGroup(
				shared.document,
				side,
				draggedSideTab,
				shared.maxSideGroups,
				groupIndex + 1,
			),
	);
	const creationTargets =
		canCreateAbove || canCreateBelow ? (
			<div className="pointer-events-none absolute inset-0 z-30">
				{canCreateAbove ? (
					<DropZone
						id={tupleKey("dnd-side-group", side, group.id, "above")}
						target={{ kind: "auxiliary-edge", region: side, index: groupIndex }}
						label={`Create ${side} group above`}
						className="absolute inset-x-4 top-4 bottom-1/2"
					/>
				) : null}
				{canCreateBelow ? (
					<DropZone
						id={tupleKey("dnd-side-group", side, group.id, "below")}
						target={{ kind: "auxiliary-edge", region: side, index: groupIndex + 1 }}
						label={`Create ${side} group below`}
						className="absolute inset-x-4 top-1/2 bottom-4"
					/>
				) : null}
			</div>
		) : null;
	return (
		<div
			data-testid={
				group.tabs.some((tab) => tab.kind === "tool" && tab.tool === "specs")
					? "right-panel"
					: "side-group"
			}
			data-side={side}
			data-group-id={group.id}
			data-folded={group.folded}
			className="relative flex h-full min-h-0 flex-col overflow-hidden bg-container-sidebar-bg"
			onFocusCapture={() => {
				if (selected) shared.onFocusGroup(location, selected.id);
			}}
		>
			<div className="flex h-panel-header-row shrink-0 items-stretch">
				<div className="min-w-0 flex-1">
					<TabStrip
						document={shared.document}
						readAttention={shared.readAttention}
						selectionEpochRef={shared.selectionEpochRef}
						location={location}
						tabs={group.tabs}
						selectedId={selected?.id}
						maxSideGroups={shared.maxSideGroups}
						maxBottomGroups={shared.maxBottomGroups}
						draggingTab={group.folded ? null : shared.draggingTab}
						onSelect={(tabId) => shared.onSelectTab(location, tabId)}
						onClose={shared.onClose}
						onApply={shared.onApply}
						onFocusAdjacentGroup={shared.onFocusAdjacentGroup}
						onHideSide={shared.onHideSide}
						onRevealTool={shared.onRevealTool}
						onRenameChat={shared.onRenameChat}
						canFocusAdjacentGroup={shared.canFocusAdjacentGroup}
						renderTabAdornment={shared.renderTabAdornment}
						trailing={
							<SideGroupMenu
								document={shared.document}
								side={side}
								groupId={group.id}
								renderSideMenuActions={shared.renderSideMenuActions}
								onRevealTool={shared.onRevealTool}
							/>
						}
					/>
				</div>
				{foldable ? (
					<IconTooltip label={group.folded ? "Expand group" : "Fold group"}>
						<button
							type="button"
							data-testid="side-group-fold"
							aria-label={group.folded ? "Expand group" : "Fold group"}
							aria-expanded={!group.folded}
							onClick={onFold}
							onKeyDown={(event) => {
								if (event.key !== "Enter" && event.key !== " ") return;
								event.preventDefault();
								onFold();
							}}
							className="flex w-32 shrink-0 items-center justify-center border-border-muted border-b border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							{group.folded ? (
								<RiExpandVerticalLine className="size-16" />
							) : (
								<RiCollapseVerticalLine className="size-16" />
							)}
						</button>
					</IconTooltip>
				) : null}
				{group.tabs.length === 0 ? (
					<IconTooltip
						label={isLayoutUnavailable(groupRemoval) ? groupRemoval.reason : "Remove group"}
					>
						<button
							type="button"
							data-testid="remove-layout-group"
							aria-label="Remove group"
							disabled={isLayoutUnavailable(groupRemoval)}
							onClick={() => {
								if (!isLayoutUnavailable(groupRemoval)) shared.onApply(groupRemoval);
							}}
							className="flex w-32 shrink-0 items-center justify-center border-border-muted border-b border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text"
						>
							<X className="size-14" />
						</button>
					</IconTooltip>
				) : null}
			</div>
			<div
				id={groupPanelId(location)}
				role="tabpanel"
				aria-labelledby={selected ? tabDomId(location, selected.id) : undefined}
				hidden={group.folded}
				className="relative min-h-0 flex-1 overflow-auto"
			>
				{!group.folded && selected ? (
					<GroupTabBody
						key={selected.id}
						tab={selected}
						renderTabBody={shared.renderTabBody}
						renderToolBody={renderToolBody}
					/>
				) : !group.folded ? (
					<div className="flex h-full items-center justify-center tr-text-metadata text-text-muted">
						Empty group
					</div>
				) : null}
				{group.folded ? null : creationTargets}
			</div>
			{group.folded ? creationTargets : null}
		</div>
	);
});
SideGroupView.displayName = "SideGroupView";

export function SideGroupMenu({
	document,
	side,
	groupId,
	renderSideMenuActions,
	onRevealTool,
}: {
	document: WorkspaceLayoutDocument;
	side: LayoutSide;
	groupId: string;
	renderSideMenuActions: WorkbenchProps["renderSideMenuActions"];
	onRevealTool: (tool: LayoutToolId) => void;
}) {
	const missing = unplacedToolsForSide(document, side);
	const actions = renderSideMenuActions(side, groupId);
	if (missing.length === 0 && !actions) return null;
	return (
		<DropdownMenu>
			<IconTooltip label="Add to this group" wrapTrigger>
				<DropdownMenuTrigger
					data-testid="side-group-menu"
					aria-label="Add to this group"
					className="flex w-32 shrink-0 items-center justify-center border-border-muted border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<Plus className="size-16" />
				</DropdownMenuTrigger>
			</IconTooltip>
			<DropdownMenuContent align="end">
				{actions}
				{actions && missing.length > 0 ? <DropdownMenuSeparator /> : null}
				{missing.map((tool) => (
					<DropdownMenuItem
						key={tool}
						data-testid={`show-tool-${tool}`}
						onSelect={() => onRevealTool(tool)}
					>
						Show {toolTab(tool).name}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export const SideStack = memo(function SideStack({
	side,
	region,
	attention,
	projectionEpoch,
	renderToolBody,
	onCommit,
	...shared
}: SharedGroupProps & {
	side: LayoutSide;
	region: WorkspaceLayoutDocument[LayoutSide];
	attention: LayoutAttention;
	projectionEpoch: number;
	renderToolBody: WorkbenchProps["renderToolBody"];
	onCommit: WorkbenchProps["onCommit"];
}) {
	const [sizeRef, size] = useElementSize();
	const total = region.groups.reduce((sum, group) => sum + group.weight, 0) || 1;
	const current = region.groups.map((group) => (group.weight / total) * 100);
	const resize = useCommittedSizes(
		current,
		projectionEpoch,
		(sizes) => {
			const next = resizeSideGroups(shared.document, side, sizes);
			if (next !== shared.document) onCommit(next);
		},
		shared.onGestureCanceled,
	);
	const foldedCount = region.groups.filter((group) => group.folded).length;
	const expandedCount = region.groups.length - foldedCount;
	const roomForMinimums =
		size.height >=
		foldedCount * LAYOUT_LIMITS.foldedSideHeight + expandedCount * LAYOUT_LIMITS.minSideBodyHeight;
	const equalShare = 100 / Math.max(1, region.groups.length);
	const requestedFoldedPercent =
		size.height > 0 ? (LAYOUT_LIMITS.foldedSideHeight / size.height) * 100 : 4;
	const foldedPercent = roomForMinimums
		? requestedFoldedPercent
		: Math.min(requestedFoldedPercent, equalShare);
	const expandedMinimum =
		roomForMinimums && size.height > 0
			? (LAYOUT_LIMITS.minSideBodyHeight / size.height) * 100
			: Math.min(4, equalShare);
	const foldedSpacerPercent = Math.max(0, 100 - foldedCount * foldedPercent);
	return (
		<aside
			ref={sizeRef}
			aria-label={`${side} workbench`}
			data-testid={side === "right" ? "right-stack" : "left-stack"}
			className="relative h-full min-h-0 overflow-hidden"
		>
			<ResizablePanelGroup
				key={tupleKey(
					"side-stack",
					side,
					String(projectionEpoch),
					...region.groups.flatMap((group) => [group.id, String(group.folded)]),
				)}
				direction="vertical"
				onLayout={(sizes) => resize.onLayout(sizes.slice(0, region.groups.length))}
			>
				{region.groups.map((group, index) => {
					const sizePercent = group.folded ? foldedPercent : current[index];
					return (
						<PanelWithHandle
							key={tupleKey("side-group", side, group.id)}
							id={tupleKey("side-stack-panel", side, group.id)}
							order={index + 1}
							defaultSize={sizePercent}
							minSize={group.folded ? foldedPercent : expandedMinimum}
							maxSize={group.folded ? foldedPercent : 100}
							showHandle={index < region.groups.length - 1}
							handleTestId={`${side}-group-resize`}
							handleDisabled={!roomForMinimums || expandedCount < 2}
							onDragging={resize.onDragging}
							onKeyboard={resize.onKeyboard}
							onKeyboardEnd={resize.onKeyboardEnd}
						>
							<SideGroupView
								side={side}
								group={group}
								groupIndex={index}
								foldable={region.groups.length > 1 || group.folded}
								selectedId={readLayoutSelection(attention, group.id)}
								renderToolBody={renderToolBody}
								onFold={() => {
									const result = setSideGroupFolded(shared.document, side, group.id, !group.folded);
									if (!isLayoutUnavailable(result)) shared.onApply(result);
								}}
								{...shared}
							/>
						</PanelWithHandle>
					);
				})}
				{expandedCount === 0 && foldedSpacerPercent > 0 ? (
					<ResizablePanel
						id={tupleKey("side-folded-spacer", side)}
						order={region.groups.length + 1}
						defaultSize={foldedSpacerPercent}
						minSize={foldedSpacerPercent}
						maxSize={foldedSpacerPercent}
					>
						<div aria-hidden="true" className="h-full" />
					</ResizablePanel>
				) : null}
			</ResizablePanelGroup>
		</aside>
	);
});
SideStack.displayName = "SideStack";

export function HiddenSideRail({
	side,
	onShow,
	dropEnabled,
	showEnabled,
	targetIndex,
}: {
	side: LayoutSide;
	onShow: () => void;
	dropEnabled: boolean;
	showEnabled: boolean;
	targetIndex: number;
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: tupleKey("dnd-hidden-side-edge", side),
		data: {
			target: { kind: "auxiliary-edge", region: side, index: targetIndex } satisfies DropTarget,
		},
		disabled: !dropEnabled,
	});
	return (
		<div
			ref={setNodeRef}
			data-testid={`${side}-layout-rail`}
			data-drop-label={dropEnabled ? `Create ${side} group in hidden side` : undefined}
			data-drop-active={isOver || undefined}
			data-drop-hint={(dropEnabled && !isOver) || undefined}
			className="flex w-28 shrink-0 flex-col items-center border-border-default bg-container-sidebar-bg py-4 first:border-r last:border-l data-[drop-hint]:bg-primary-subtle data-[drop-hint]:ring-1 data-[drop-hint]:ring-inset data-[drop-hint]:ring-primary-soft data-[drop-active]:bg-primary-soft data-[drop-active]:ring-2 data-[drop-active]:ring-inset data-[drop-active]:ring-primary"
		>
			<IconTooltip
				label={showEnabled ? `Show ${side} side` : `No ${side} groups to show`}
				wrapTrigger
			>
				<button
					type="button"
					aria-label={`Show ${side} side`}
					disabled={!showEnabled}
					onClick={onShow}
					className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:pointer-events-none disabled:text-control-disabled-text"
				>
					{side === "left" ? (
						<PanelLeftOpen className="size-14" />
					) : (
						<PanelRightOpen className="size-14" />
					)}
				</button>
			</IconTooltip>
		</div>
	);
}
