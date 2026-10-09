import { useDroppable } from "@dnd-kit/core";
import { RiAddLine as Plus, RiCloseLine as X } from "@remixicon/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { type ImperativePanelGroupHandle, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { memo, type ReactNode, useMemo, useRef } from "react";
import { type LayoutAttention, readLayoutSelection, tupleKey } from "../../lib";
import { AuxiliaryPaneHeader, AuxiliaryPaneHideButton } from "./AuxiliaryPaneHeader";
import { resizeVisibleAuxiliaryGroups, visibleAuxiliaryGroups } from "./auxiliaryPresentation";
import {
	canCreateSideGroup,
	canJoinAuxiliaryGroup,
	canPlaceLayoutTab,
	isLayoutUnavailable,
	LAYOUT_LIMITS,
	type LayoutGroupLocation,
	type LayoutSide,
	layoutTabName,
	removeLayoutGroup,
	setSideGroupFolded,
	toolTab,
	unplacedToolsForRegion,
} from "./model";
import type {
	LayoutAuxiliaryRegion,
	LayoutSideGroup,
	LayoutTab,
	LayoutTerminalTab,
	LayoutToolId,
	WorkspaceLayoutDocument,
} from "./types";
import type { DropTarget, SharedGroupProps, WorkbenchProps } from "./workbenchShared";
import {
	DropZone,
	GroupTabBody,
	groupDomId,
	groupPanelId,
	PanelWithHandle,
	tabDomId,
	useCommittedSizes,
	useElementSize,
	useEnforcedLayout,
	useTopologySettled,
} from "./workbenchShared";
import { TabStrip } from "./workbenchTabs";

export const SideGroupView = memo(function SideGroupView({
	side,
	group,
	groupIndex,
	selectedId,
	renderToolBody,
	onFold,
	...shared
}: SharedGroupProps & {
	side: LayoutSide;
	group: LayoutSideGroup;
	groupIndex: number;
	selectedId: string | undefined;
	renderToolBody: WorkbenchProps["renderToolBody"];
	onFold: () => void;
}) {
	const location: LayoutGroupLocation = { area: side, groupId: group.id };
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
		<section
			id={groupDomId(location)}
			tabIndex={-1}
			aria-label={`${side} pane: ${selected ? layoutTabName(selected) : "Tools"}`}
			data-testid={
				group.tabs.some((tab) => tab.kind === "tool" && tab.tool === "specs")
					? "right-panel"
					: "side-group"
			}
			data-side={side}
			data-group-id={group.id}
			data-tools={group.tabs.flatMap((tab) => (tab.kind === "tool" ? [tab.tool] : [])).join(" ")}
			data-folded="false"
			className="relative flex h-full min-h-0 flex-col overflow-hidden bg-container-sidebar-bg"
			onFocusCapture={() => {
				if (selected) shared.onFocusGroup(location, selected.id);
			}}
		>
			<AuxiliaryGroupHeader
				region={side}
				group={group}
				selected={selected}
				shared={{ ...shared, renderToolBody }}
				onFold={onFold}
			/>
			<section
				id={groupPanelId(location)}
				role={selected?.kind === "terminal" ? "tabpanel" : undefined}
				aria-labelledby={selected ? tabDomId(location, selected.id) : undefined}
				className="relative min-h-0 flex-1 overflow-auto"
			>
				{selected ? (
					<GroupTabBody
						key={selected.id}
						tab={selected}
						renderTabBody={shared.renderTabBody}
						renderToolBody={renderToolBody}
					/>
				) : (
					<div className="flex h-full items-center justify-center tr-text-metadata text-text-muted">
						Empty group
					</div>
				)}
				{creationTargets}
			</section>
		</section>
	);
});
SideGroupView.displayName = "SideGroupView";

export function SideGroupMenu({
	document,
	side,
	group,
	limit,
	onNewTerminal,
	onRevealTool,
}: {
	document: WorkspaceLayoutDocument;
	side: LayoutAuxiliaryRegion;
	group: LayoutSideGroup;
	limit: number;
	onNewTerminal: WorkbenchProps["onNewTerminal"];
	onRevealTool: (tool: LayoutToolId) => void;
}) {
	const missing = unplacedToolsForRegion(document, side);
	const toolPane = group.tabs.some((tab) => tab.kind === "tool");
	const paneBelowAvailable = !toolPane || document[side].groups.length < limit;
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
				<DropdownMenuItem
					data-testid="side-new-terminal"
					disabled={!paneBelowAvailable}
					onSelect={() => onNewTerminal(group.id, side, toolPane ? { newPaneBelow: true } : {})}
				>
					{toolPane
						? `New terminal pane ${side === "bottom" ? "to the right" : "below"}${paneBelowAvailable ? "" : ` — limited to ${limit}`}`
						: "New terminal"}
				</DropdownMenuItem>
				{missing.length > 0 ? <DropdownMenuSeparator /> : null}
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

export function AuxiliaryGroupHeader({
	region,
	group,
	selected,
	shared,
	onFold,
	trailing,
}: {
	region: LayoutAuxiliaryRegion;
	group: LayoutSideGroup;
	selected: LayoutTab | undefined;
	shared: SharedGroupProps;
	onFold: () => void;
	trailing?: ReactNode;
}) {
	const location: LayoutGroupLocation = { area: region, groupId: group.id };
	const terminals = group.tabs.filter((tab): tab is LayoutTerminalTab => tab.kind === "terminal");
	const dropEnabled =
		selected?.kind !== "terminal" &&
		!!shared.draggingTab &&
		canPlaceLayoutTab(shared.draggingTab, region) &&
		canJoinAuxiliaryGroup(group, shared.draggingTab);
	const { setNodeRef, isOver } = useDroppable({
		id: tupleKey("dnd-pane-header", region, group.id),
		data: { target: { kind: "group", location } satisfies DropTarget },
		disabled: !dropEnabled,
	});
	const removal = removeLayoutGroup(shared.document, location);
	const actions = (
		<>
			<SideGroupMenu
				document={shared.document}
				side={region}
				group={group}
				limit={region === "bottom" ? shared.maxBottomGroups : shared.maxSideGroups}
				onNewTerminal={shared.onNewTerminal}
				onRevealTool={shared.onRevealTool}
			/>
			{trailing}
			{group.tabs.length === 0 ? (
				<IconTooltip label={isLayoutUnavailable(removal) ? removal.reason : "Remove group"}>
					<button
						type="button"
						data-testid="remove-layout-group"
						aria-label="Remove group"
						disabled={isLayoutUnavailable(removal)}
						onClick={() => {
							if (!isLayoutUnavailable(removal)) shared.onApply(removal);
						}}
						className="flex w-32 shrink-0 items-center justify-center text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text"
					>
						<X className="size-14" />
					</button>
				</IconTooltip>
			) : null}
			<AuxiliaryPaneHideButton
				testId={region === "bottom" ? "bottom-group-fold" : "side-group-fold"}
				controls={groupPanelId(location)}
				onClick={onFold}
			/>
		</>
	);
	if (selected?.kind === "terminal")
		return (
			<TabStrip
				document={shared.document}
				readAttention={shared.readAttention}
				selectionEpochRef={shared.selectionEpochRef}
				location={location}
				tabs={terminals}
				selectedId={selected.id}
				maxSideGroups={shared.maxSideGroups}
				maxBottomGroups={shared.maxBottomGroups}
				draggingTab={shared.draggingTab}
				onSelect={(tabId) => {
					shared.onUserNavigation();
					shared.onSelectTab(location, tabId);
				}}
				onClose={shared.onClose}
				onApply={shared.onApply}
				onFocusAdjacentGroup={shared.onFocusAdjacentGroup}
				onHideSide={shared.onHideSide}
				onRevealTool={shared.onRevealTool}
				onRenameChat={shared.onRenameChat}
				canFocusAdjacentGroup={shared.canFocusAdjacentGroup}
				renderTabAdornment={shared.renderTabAdornment}
				trailing={actions}
			/>
		);
	return (
		<AuxiliaryPaneHeader
			ref={setNodeRef}
			title={selected ? layoutTabName(selected) : region === "bottom" ? "Terminal" : "Tools"}
			{...(selected?.kind === "tool" ? { dragTab: selected } : {})}
			actions={actions}
			data-group-id={group.id}
			data-drop-label={dropEnabled ? `Join ${region} group` : undefined}
			data-drop-active={isOver || undefined}
			data-drop-hint={(dropEnabled && !isOver) || undefined}
			className="data-[drop-hint]:bg-primary-subtle data-[drop-active]:bg-primary-soft"
		/>
	);
}

export const SideStack = memo(function SideStack({
	side,
	attention,
	projectionEpoch,
	renderToolBody,
	onCommit,
	...shared
}: SharedGroupProps & {
	side: LayoutSide;
	attention: LayoutAttention;
	projectionEpoch: number;
	renderToolBody: WorkbenchProps["renderToolBody"];
	onCommit: WorkbenchProps["onCommit"];
}) {
	const [sizeRef, size] = useElementSize();
	const visible = useMemo(
		() => visibleAuxiliaryGroups(shared.document, side),
		[shared.document, side],
	);
	const current = useMemo(() => visible.map(({ size }) => size), [visible]);
	const groupRef = useRef<ImperativePanelGroupHandle>(null);
	const roomForMinimums = size.height >= visible.length * LAYOUT_LIMITS.minSideBodyHeight;
	const settled = useTopologySettled(tupleKey(side, ...visible.map(({ group }) => group.id)));
	const expandedMinimum = !settled
		? 0
		: roomForMinimums && size.height > 0
			? (LAYOUT_LIMITS.minSideBodyHeight / size.height) * 100
			: Math.min(4, 100 / Math.max(1, visible.length));
	useEnforcedLayout(groupRef, current, settled);
	const resize = useCommittedSizes(
		current,
		tupleKey(shared.workspaceId, String(projectionEpoch)),
		groupRef,
		(sizes) => {
			const next = resizeVisibleAuxiliaryGroups(shared.document, side, sizes);
			if (next !== shared.document) onCommit(next);
		},
		shared.onGestureCanceled,
	);
	return (
		<aside
			ref={sizeRef}
			aria-label={`${side} workbench`}
			data-testid={side === "right" ? "right-stack" : "left-stack"}
			className="relative h-full min-h-0 overflow-hidden"
		>
			<ResizablePanelGroup ref={groupRef} direction="vertical" onLayout={resize.onLayout}>
				{visible.map(({ group, documentIndex, size: sizePercent }, index) => {
					return (
						<PanelWithHandle
							key={tupleKey("side-group", side, group.id)}
							id={tupleKey("side-stack-panel", side, group.id)}
							order={index + 1}
							defaultSize={sizePercent}
							minSize={expandedMinimum}
							showHandle={index < visible.length - 1}
							handleTestId={`${side}-group-resize`}
							handleDisabled={!roomForMinimums || visible.length < 2}
							onDragging={resize.onDragging}
							onKeyboard={resize.onKeyboard}
							onKeyboardEnd={resize.onKeyboardEnd}
						>
							<SideGroupView
								side={side}
								group={group}
								groupIndex={documentIndex}
								selectedId={readLayoutSelection(attention, group.id)}
								renderToolBody={renderToolBody}
								onFold={() => {
									const result = setSideGroupFolded(shared.document, side, group.id, !group.folded);
									if (!isLayoutUnavailable(result))
										shared.onApply({ ...result, focusGroupId: group.id });
								}}
								{...shared}
							/>
						</PanelWithHandle>
					);
				})}
			</ResizablePanelGroup>
		</aside>
	);
});
SideStack.displayName = "SideStack";
