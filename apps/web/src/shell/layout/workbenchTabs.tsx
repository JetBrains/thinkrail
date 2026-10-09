import { useDraggable, useDroppable } from "@dnd-kit/core";
import { RiSearchLine as Search, RiCloseLine as X } from "@remixicon/react";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@thinkrail/ui/command";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { Fragment, memo, type ReactNode, useEffect, useRef, useState } from "react";
import { DOUBLE_CLICK_SETTLE_MS, type LayoutAttention, tupleKey } from "../../lib";
import {
	type AuxiliaryRailControlProps,
	AuxiliaryRailIndicator,
	RAIL_ENTRY_BUTTON_CLASS,
	railEntryFrameClass,
	railTooltipSide,
} from "./AuxiliaryRail";
import {
	type CenterSplitDirection,
	canCreateAuxiliaryGroup,
	canJoinAuxiliaryGroup,
	collectAllGroups,
	collectCenterGroups,
	createAuxiliaryGroup,
	describeLayoutGroup,
	isLayoutUnavailable,
	LAYOUT_LIMITS,
	type LayoutGroupLocation,
	type LayoutMutationResult,
	layoutTabName,
	moveTabToGroup,
	removeLayoutGroup,
	SEPARATE_PANES_REASON,
	splitCenterGroup,
	toolTab,
	unplacedTools,
} from "./model";
import { tabIcon } from "./tabIcon";
import type {
	LayoutAuxiliaryRegion,
	LayoutTab,
	LayoutToolId,
	WorkspaceLayoutDocument,
} from "./types";
import type { DragData, DropTarget, WorkbenchProps } from "./workbenchShared";
import {
	canInsertDraggedTab,
	DropZone,
	findLayoutGroupTabs,
	groupPanelId,
	navigationClockSnapshot,
	tabDomId,
	tabSearchKeywords,
	useHorizontalOverflow,
} from "./workbenchShared";

export interface TabStripProps {
	document: WorkspaceLayoutDocument;
	readAttention: () => LayoutAttention;
	selectionEpochRef: React.MutableRefObject<number>;
	location: LayoutGroupLocation;
	tabs: LayoutTab[];
	selectedId?: string | undefined;
	previewId?: string | undefined;
	maxSideGroups: number;
	maxBottomGroups: number;
	draggingTab: LayoutTab | null;
	onSelect: (tabId: string, keep?: boolean) => void;
	onClose: (tab: LayoutTab) => void;
	onApply: (result: LayoutMutationResult) => void;
	onFocusAdjacentGroup: (delta: -1 | 1, fromGroupId?: string) => void;
	onHideSide: (region: LayoutAuxiliaryRegion) => void;
	onRevealTool: (tool: LayoutToolId) => void;
	onRenameChat: WorkbenchProps["onRenameChat"];
	canFocusAdjacentGroup: boolean;
	renderTabAdornment: WorkbenchProps["renderTabAdornment"];
	splitGeometry?: { horizontal: boolean; vertical: boolean };
	trailing?: ReactNode;
}

export const TabStrip = memo(function TabStrip({
	document,
	readAttention,
	selectionEpochRef,
	location,
	tabs,
	selectedId,
	previewId,
	maxSideGroups,
	maxBottomGroups,
	draggingTab,
	onSelect,
	onClose,
	onApply,
	onFocusAdjacentGroup,
	onHideSide,
	onRevealTool,
	onRenameChat,
	canFocusAdjacentGroup,
	renderTabAdornment,
	splitGeometry,
	trailing,
}: TabStripProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const scrollOverflow = useHorizontalOverflow(scroller);
	const tabRefs = useRef(new Map<string, HTMLElement>());
	const overflowFocusTarget = useRef<string | null>(null);
	const [overflowOpen, setOverflowOpen] = useState(false);
	const overflowing = scrollOverflow.before || scrollOverflow.after;
	const selectTab = (tabId: string, keep?: boolean) => {
		selectionEpochRef.current += 1;
		onSelect(tabId, keep);
	};
	const applyResult = (result: LayoutMutationResult) => {
		selectionEpochRef.current += 1;
		onApply(result);
	};
	const closeTab = (tab: LayoutTab) => {
		selectionEpochRef.current += 1;
		onClose(tab);
	};
	const acceptsAppend =
		draggingTab !== null && canInsertDraggedTab(document, draggingTab, location, tabs.length);
	const panelId = groupPanelId(location);
	const { setNodeRef: setGroupDropRef, isOver: groupDropOver } = useDroppable({
		id: tupleKey("dnd-group", location.area, location.groupId),
		data: { target: { kind: "group", location } satisfies DropTarget },
		disabled: !acceptsAppend,
	});

	useEffect(() => {
		if (selectedId)
			tabRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [selectedId]);

	useEffect(() => {
		if (!overflowing) setOverflowOpen(false);
	}, [overflowing]);

	const selectAt = (index: number) => {
		const tab = tabs[index];
		if (!tab) return;
		selectTab(tab.id);
		const epoch = selectionEpochRef.current;
		requestAnimationFrame(() => {
			if (selectionEpochRef.current === epoch) tabRefs.current.get(tab.id)?.focus();
		});
	};

	const testId =
		location.area === "center"
			? "center-tab-strip"
			: location.area === "bottom"
				? "bottom-tab-strip"
				: "workbench-tab-strip";
	return (
		<div
			ref={setGroupDropRef}
			data-testid={testId}
			data-area={location.area}
			data-group-id={location.groupId}
			data-drop-active={groupDropOver || undefined}
			data-drop-hint={(acceptsAppend && !groupDropOver) || undefined}
			className="relative flex h-panel-header-row shrink-0 items-stretch border-border-default border-b bg-container-workspace-bg data-[drop-hint]:ring-1 data-[drop-hint]:ring-inset data-[drop-hint]:ring-primary-soft data-[drop-active]:bg-primary-subtle data-[drop-active]:ring-2 data-[drop-active]:ring-inset data-[drop-active]:ring-primary"
		>
			<div className="relative min-w-0 flex-1 overflow-hidden">
				<div
					ref={scroller}
					role="tablist"
					aria-label={`${location.area} group tabs`}
					className="flex h-full w-full min-w-0 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
					onWheel={(event) => {
						if (!scroller.current || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
						scroller.current.scrollLeft += event.deltaY;
					}}
				>
					{tabs.map((tab, index) => (
						<WorkbenchTab
							key={tab.id}
							tab={tab}
							index={index}
							reorderIndexes={{
								previous: index > 0 ? index - 1 : undefined,
								next: index < tabs.length - 1 ? index + 1 : undefined,
							}}
							location={location}
							readAttention={readAttention}
							selectionEpochRef={selectionEpochRef}
							active={tab.id === selectedId}
							preview={tab.id === previewId}
							document={document}
							maxSideGroups={maxSideGroups}
							maxBottomGroups={maxBottomGroups}
							register={(node) => {
								if (node) tabRefs.current.set(tab.id, node);
								else tabRefs.current.delete(tab.id);
							}}
							onSelect={selectTab}
							onClose={() => closeTab(tab)}
							onApply={applyResult}
							onFocusAdjacentGroup={onFocusAdjacentGroup}
							onHideSide={onHideSide}
							onRevealTool={onRevealTool}
							onRenameChat={onRenameChat}
							canFocusAdjacentGroup={canFocusAdjacentGroup}
							renderTabAdornment={renderTabAdornment}
							draggingTab={draggingTab}
							panelId={panelId}
							{...(splitGeometry ? { splitGeometry } : {})}
							onKeyDown={(event) => {
								if (event.altKey && event.shiftKey && event.key === "ArrowLeft") {
									event.preventDefault();
									if (index > 0) {
										const moved = moveTabToGroup(document, tab, location, index - 1);
										if (!isLayoutUnavailable(moved)) applyResult(moved);
									}
								} else if (event.altKey && event.shiftKey && event.key === "ArrowRight") {
									event.preventDefault();
									if (index < tabs.length - 1) {
										const moved = moveTabToGroup(document, tab, location, index + 1);
										if (!isLayoutUnavailable(moved)) applyResult(moved);
									}
								} else if (event.key === "ArrowLeft") {
									event.preventDefault();
									selectAt(index === 0 ? tabs.length - 1 : index - 1);
								} else if (event.key === "ArrowRight") {
									event.preventDefault();
									selectAt(index === tabs.length - 1 ? 0 : index + 1);
								} else if (event.key === "Home") {
									event.preventDefault();
									selectAt(0);
								} else if (event.key === "End") {
									event.preventDefault();
									selectAt(tabs.length - 1);
								} else if (event.key === "Delete") {
									event.preventDefault();
									closeTab(tab);
								}
							}}
						/>
					))}
					{acceptsAppend ? (
						<DropZone
							id={tupleKey(
								"dnd-insert",
								location.area,
								location.groupId,
								String(tabs.length),
								"end",
							)}
							target={{ kind: "insert", location, index: tabs.length }}
							label="Insert at end"
							className="relative h-full w-20 shrink-0"
						/>
					) : null}
				</div>
				{scrollOverflow.before ? (
					<div
						aria-hidden="true"
						data-testid="tab-overflow-before"
						className="pointer-events-none absolute inset-y-0 left-0 z-20 w-16 bg-[linear-gradient(to_right,var(--color-container-workspace-bg),transparent)]"
					/>
				) : null}
				{scrollOverflow.after ? (
					<div
						aria-hidden="true"
						data-testid="tab-overflow-after"
						className="pointer-events-none absolute inset-y-0 right-0 z-20 w-16 bg-[linear-gradient(to_left,var(--color-container-workspace-bg),transparent)]"
					/>
				) : null}
			</div>
			{trailing}
			{overflowing ? (
				<Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
					<IconTooltip label="Search open tabs" wrapTrigger>
						<PopoverTrigger
							aria-label="Search open tabs"
							className="flex w-32 shrink-0 items-center justify-center border-border-muted border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							<Search className="size-14" />
						</PopoverTrigger>
					</IconTooltip>
					<PopoverContent
						align="end"
						className="w-288 p-0"
						onCloseAutoFocus={(event) => {
							const targetId = overflowFocusTarget.current;
							if (!targetId) return;
							overflowFocusTarget.current = null;
							event.preventDefault();
							tabRefs.current.get(targetId)?.focus();
						}}
					>
						<Command>
							<CommandInput placeholder="Find an open tab…" />
							<CommandList>
								<CommandEmpty>No matching tabs.</CommandEmpty>
								{tabs.map((tab) => (
									<CommandItem
										key={tab.id}
										value={tab.id}
										keywords={tabSearchKeywords(tab)}
										onSelect={() => {
											overflowFocusTarget.current = tab.id;
											selectTab(tab.id);
											setOverflowOpen(false);
										}}
									>
										{tabIcon(tab)}
										<span className="truncate">{layoutTabName(tab)}</span>
									</CommandItem>
								))}
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			) : null}
		</div>
	);
});
TabStrip.displayName = "TabStrip";

export interface WorkbenchTabProps {
	tab: LayoutTab;
	index: number;
	reorderIndexes?: { previous: number | undefined; next: number | undefined };
	rail?: AuxiliaryRailControlProps & {
		entryKey: string;
		vertical: boolean;
		beforeIndex: number;
		afterIndex: number;
		onActivate: () => void;
	};
	location: LayoutGroupLocation;
	readAttention: () => LayoutAttention;
	selectionEpochRef: React.MutableRefObject<number>;
	active: boolean;
	preview: boolean;
	document: WorkspaceLayoutDocument;
	maxSideGroups: number;
	maxBottomGroups: number;
	register: (node: HTMLElement | null) => void;
	onSelect: (tabId: string, keep?: boolean) => void;
	onClose: () => void;
	onApply: (result: LayoutMutationResult) => void;
	onFocusAdjacentGroup: (delta: -1 | 1, fromGroupId?: string) => void;
	onHideSide: (region: LayoutAuxiliaryRegion) => void;
	onRevealTool: (tool: LayoutToolId) => void;
	onRenameChat: WorkbenchProps["onRenameChat"];
	canFocusAdjacentGroup: boolean;
	renderTabAdornment: WorkbenchProps["renderTabAdornment"];
	draggingTab: LayoutTab | null;
	panelId: string;
	splitGeometry?: { horizontal: boolean; vertical: boolean };
	onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export const WorkbenchTab = memo(function WorkbenchTab({
	tab,
	index,
	reorderIndexes,
	rail,
	location,
	readAttention,
	selectionEpochRef,
	active,
	preview,
	document,
	maxSideGroups,
	maxBottomGroups,
	register,
	onSelect,
	onClose,
	onApply,
	onFocusAdjacentGroup,
	onHideSide,
	onRevealTool,
	onRenameChat,
	canFocusAdjacentGroup,
	renderTabAdornment,
	draggingTab,
	panelId,
	splitGeometry,
	onKeyDown,
}: WorkbenchTabProps) {
	const {
		setNodeRef: setDragRef,
		isDragging,
		listeners: dragListeners,
	} = useDraggable({ id: tupleKey("dnd-tab", tab.id), data: { tab } satisfies DragData });
	const pendingPreviewKeep = useRef<ReturnType<typeof setTimeout> | null>(null);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const editStartNameRef = useRef("");
	const cancelNextBlurRef = useRef(false);
	const enterRenameRef = useRef(false);
	const restoreTabFocusRef = useRef(false);
	const [editingName, setEditingName] = useState(false);
	useEffect(
		() => () => {
			if (pendingPreviewKeep.current) clearTimeout(pendingPreviewKeep.current);
		},
		[],
	);
	useEffect(() => {
		if (!editingName) return;
		const frame = requestAnimationFrame(() => {
			nameInputRef.current?.focus();
			nameInputRef.current?.select();
		});
		return () => cancelAnimationFrame(frame);
	}, [editingName]);
	const focusControl = () => {
		const epoch = selectionEpochRef.current;
		requestAnimationFrame(() => {
			if (selectionEpochRef.current === epoch)
				globalThis.document.getElementById(tabDomId(location, tab.id))?.focus();
		});
	};
	const closeNameEditor = () => {
		setEditingName(false);
		if (!restoreTabFocusRef.current) return;
		restoreTabFocusRef.current = false;
		focusControl();
	};
	const commitRename = () => {
		if (cancelNextBlurRef.current) {
			cancelNextBlurRef.current = false;
			closeNameEditor();
			return;
		}
		const titleInput = nameInputRef.current?.value ?? "";
		closeNameEditor();
		if (tab.kind !== "chat") return;
		onRenameChat?.(tab.sessionId, titleInput, editStartNameRef.current);
	};
	const onNameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		event.stopPropagation();
		if (event.key === "Enter") {
			event.preventDefault();
			restoreTabFocusRef.current = true;
			nameInputRef.current?.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			restoreTabFocusRef.current = true;
			cancelNextBlurRef.current = true;
			nameInputRef.current?.blur();
		}
	};
	const selectFromClick = () => {
		if (!preview) {
			onSelect(tab.id);
			return;
		}
		if (pendingPreviewKeep.current) clearTimeout(pendingPreviewKeep.current);
		const gestureEpoch = ++selectionEpochRef.current;
		const navigationClocks = navigationClockSnapshot(readAttention());
		pendingPreviewKeep.current = setTimeout(() => {
			pendingPreviewKeep.current = null;
			if (
				selectionEpochRef.current !== gestureEpoch ||
				navigationClockSnapshot(readAttention()) !== navigationClocks
			) {
				return;
			}
			onSelect(tab.id, active);
		}, DOUBLE_CLICK_SETTLE_MS);
	};
	const selectFromDoubleClick = () => {
		if (pendingPreviewKeep.current) clearTimeout(pendingPreviewKeep.current);
		pendingPreviewKeep.current = null;
		onSelect(tab.id, true);
	};
	const beforeIndex = rail?.beforeIndex ?? index;
	const afterIndex = rail?.afterIndex ?? index + 1;
	const previousIndex = reorderIndexes
		? reorderIndexes.previous
		: index > 0
			? index - 1
			: undefined;
	const nextIndex = reorderIndexes
		? reorderIndexes.next
		: index < (findLayoutGroupTabs(document, location)?.length ?? 0) - 1
			? index + 1
			: undefined;
	const acceptsBefore =
		draggingTab !== null && canInsertDraggedTab(document, draggingTab, location, beforeIndex);
	const acceptsAfter =
		draggingTab !== null && canInsertDraggedTab(document, draggingTab, location, afterIndex);
	const { setNodeRef: setBeforeRef, isOver: beforeOver } = useDroppable({
		id: tupleKey(rail ? "dnd-rail-insert" : "dnd-insert", location.area, tab.id, "before"),
		data: { target: { kind: "insert", location, index: beforeIndex } satisfies DropTarget },
		disabled: !acceptsBefore,
	});
	const { setNodeRef: setAfterRef, isOver: afterOver } = useDroppable({
		id: tupleKey(rail ? "dnd-rail-insert" : "dnd-insert", location.area, tab.id, "after"),
		data: { target: { kind: "insert", location, index: afterIndex } satisfies DropTarget },
		disabled: !acceptsAfter,
	});
	const groups = collectAllGroups(document);
	const missingTools = unplacedTools(document);
	const splitReason = (direction: CenterSplitDirection): string | null => {
		if (location.area !== "center") return "Only center tabs can split the center.";
		if (tab.kind === "tool") return "Tools stay in a side region.";
		if (collectCenterGroups(document.center).length >= LAYOUT_LIMITS.maxCenterGroups) {
			return `Center groups are limited to ${LAYOUT_LIMITS.maxCenterGroups}.`;
		}
		const horizontal = direction === "left" || direction === "right";
		if (splitGeometry && !(horizontal ? splitGeometry.horizontal : splitGeometry.vertical)) {
			return horizontal
				? `This group needs ${LAYOUT_LIMITS.minCenterWidth * 2}px of width to split.`
				: `This group needs ${LAYOUT_LIMITS.minCenterHeight * 2}px of height to split.`;
		}
		return null;
	};
	const moveTargets = groups.filter(
		(group) =>
			group.location.groupId !== location.groupId &&
			(tab.kind === "terminal" || group.location.area === "center"
				? tab.kind !== "tool"
				: tab.kind === "tool"),
	);
	const currentAuxiliary = location.area === "center" ? null : location.area;
	const currentAuxiliaryGroupIndex = currentAuxiliary
		? document[currentAuxiliary].groups.findIndex((group) => group.id === location.groupId)
		: -1;
	const currentAuxiliaryLimit = currentAuxiliary === "bottom" ? maxBottomGroups : maxSideGroups;
	const name = layoutTabName(tab);
	const groupRemoval = removeLayoutGroup(document, location);

	const move = (target: LayoutGroupLocation, targetIndex?: number) => {
		const result = moveTabToGroup(document, tab, target, targetIndex);
		if (!isLayoutUnavailable(result)) onApply(result);
	};
	const reorder = (nextIndex: number) => move(location, nextIndex);
	const focusTab = (keep?: boolean) => {
		onSelect(tab.id, keep);
		focusControl();
	};

	const tabButton = (
		<button
			ref={register}
			type="button"
			id={tabDomId(location, tab.id)}
			{...(rail
				? { "aria-label": name, "aria-pressed": active }
				: { role: "tab", "aria-selected": active })}
			aria-keyshortcuts={
				rail
					? rail.vertical
						? "Enter Space Delete Home End ArrowUp ArrowDown Alt+Shift+ArrowUp Alt+Shift+ArrowDown Control+F6 Control+Shift+F6"
						: "Enter Space Delete Home End ArrowLeft ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Control+F6 Control+Shift+F6"
					: "Delete Home End ArrowLeft ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Control+F6 Control+Shift+F6"
			}
			aria-controls={panelId}
			data-testid={rail && tab.kind === "tool" ? `tool-rail-${tab.tool}` : undefined}
			data-rail-entry={rail?.entryKey}
			data-layout-tab-id={tab.id}
			tabIndex={rail ? rail.tabIndex : active ? 0 : -1}
			{...dragListeners}
			title={rail ? undefined : preview ? "Preview — double-click to keep" : name}
			onFocus={rail?.onFocus}
			onClick={rail ? rail.onActivate : selectFromClick}
			onDoubleClick={rail ? undefined : selectFromDoubleClick}
			onKeyDown={onKeyDown}
			className={
				rail
					? RAIL_ENTRY_BUTTON_CLASS
					: cn(
							"relative flex min-w-0 flex-1 items-center gap-4 py-4 pl-8 text-left outline-none",
							tab.kind === "tool" && "pr-8",
						)
			}
		>
			{tabIcon(tab, active)}
			{rail ? null : <span className={`truncate ${preview ? "italic" : ""}`}>{name}</span>}
			{rail ? (
				<span className="pointer-events-none absolute top-0 right-0 flex">
					{renderTabAdornment(tab)}
				</span>
			) : (
				renderTabAdornment(tab)
			)}
		</button>
	);
	const tabTestId =
		tab.kind === "terminal"
			? "terminal-tab"
			: tab.kind === "tool"
				? `tab-${tab.tool}`
				: "editor-tab";
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					ref={setDragRef}
					role="presentation"
					data-testid={tabTestId}
					data-active={active}
					data-preview={preview}
					data-kind={tab.kind === "document" ? "plan" : tab.kind}
					data-session-id={tab.kind === "chat" ? tab.sessionId : undefined}
					data-dragging={(isDragging && draggingTab?.id === tab.id) || undefined}
					className={cn(
						"group data-[dragging]:opacity-40",
						rail
							? railEntryFrameClass(location.area)
							: "relative flex min-w-96 max-w-192 shrink-0 items-center border-border-default border-r text-text-muted after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-[2px] after:rounded-full after:content-[''] has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-inset has-[[role=tab]:focus-visible]:ring-primary data-[active=true]:bg-control-bg-selected data-[active=true]:text-text-default data-[active=true]:after:bg-primary",
					)}
				>
					<div
						ref={setBeforeRef}
						aria-hidden="true"
						data-drop-label={acceptsBefore ? `Insert before ${name}` : undefined}
						data-drop-active={beforeOver || undefined}
						className={cn(
							"pointer-events-none absolute z-10 border-primary",
							rail?.vertical
								? "inset-x-0 top-0 h-1/2 data-[drop-active]:border-t-2"
								: "inset-y-0 left-0 w-1/2 data-[drop-active]:border-l-2",
						)}
					/>
					<div
						ref={setAfterRef}
						aria-hidden="true"
						data-drop-label={acceptsAfter ? `Insert after ${name}` : undefined}
						data-drop-active={afterOver || undefined}
						className={cn(
							"pointer-events-none absolute z-10 border-primary",
							rail?.vertical
								? "inset-x-0 bottom-0 h-1/2 data-[drop-active]:border-b-2"
								: "inset-y-0 right-0 w-1/2 data-[drop-active]:border-r-2",
						)}
					/>
					{rail && active && location.area !== "center" ? (
						<AuxiliaryRailIndicator region={location.area} />
					) : null}
					{editingName && tab.kind === "chat" ? (
						<div ref={register} className="flex min-w-0 flex-1 items-center gap-4 py-4 pl-8">
							{tabIcon(tab, active)}
							<input
								ref={nameInputRef}
								data-testid="chat-tab-name-input"
								type="text"
								spellCheck={false}
								aria-label="Chat name"
								defaultValue={name}
								onKeyDown={onNameKeyDown}
								onBlur={commitRename}
								className="min-w-0 flex-1 border-0 bg-transparent p-0 tr-text-ui text-text-default outline-none"
							/>
						</div>
					) : rail ? (
						<IconTooltip label={name} side={railTooltipSide(location.area)}>
							{tabButton}
						</IconTooltip>
					) : (
						tabButton
					)}
					{tab.kind !== "tool" ? (
						<button
							type="button"
							tabIndex={-1}
							data-testid={tab.kind === "terminal" ? "terminal-tab-close" : "editor-tab-close"}
							aria-label={`Close ${name}`}
							onClick={onClose}
							className="mr-4 rounded-[var(--radius-sm)] p-2 opacity-0 hover:bg-control-bg-hovered group-hover:opacity-100 focus:opacity-100"
						>
							<X className="size-14" />
						</button>
					) : null}
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent
				onCloseAutoFocus={(event) => {
					if (!enterRenameRef.current) return;
					enterRenameRef.current = false;
					event.preventDefault();
				}}
			>
				<ContextMenuItem onSelect={() => focusTab()}>Focus tab</ContextMenuItem>
				{tab.kind === "chat" && onRenameChat ? (
					<ContextMenuItem
						onSelect={() => {
							editStartNameRef.current = name;
							cancelNextBlurRef.current = false;
							restoreTabFocusRef.current = false;
							enterRenameRef.current = true;
							setEditingName(true);
						}}
					>
						Rename chat
					</ContextMenuItem>
				) : null}
				<ContextMenuItem
					disabled={!canFocusAdjacentGroup}
					onSelect={() => onFocusAdjacentGroup(-1, location.groupId)}
				>
					{canFocusAdjacentGroup
						? "Focus previous group"
						: "Focus previous group — no other visible group"}
				</ContextMenuItem>
				<ContextMenuItem
					disabled={!canFocusAdjacentGroup}
					onSelect={() => onFocusAdjacentGroup(1, location.groupId)}
				>
					{canFocusAdjacentGroup ? "Focus next group" : "Focus next group — no other visible group"}
				</ContextMenuItem>
				{location.area === "center" ? (
					<ContextMenuItem disabled={!preview} onSelect={() => focusTab(true)}>
						{preview ? "Keep preview" : "Keep preview — already kept"}
					</ContextMenuItem>
				) : null}
				<ContextMenuItem
					disabled={previousIndex === undefined}
					onSelect={() => {
						if (previousIndex !== undefined) reorder(previousIndex);
					}}
				>
					Move {rail?.vertical ? "up" : "left"}
					{previousIndex === undefined ? " — already first" : ""}
				</ContextMenuItem>
				<ContextMenuItem
					disabled={nextIndex === undefined}
					onSelect={() => {
						if (nextIndex !== undefined) reorder(nextIndex);
					}}
				>
					Move {rail?.vertical ? "down" : "right"}
					{nextIndex === undefined ? " — already last" : ""}
				</ContextMenuItem>
				{location.area === "center" ? (
					<>
						<ContextMenuSeparator />
						{(["left", "right", "up", "down"] as const).map((direction) => {
							const unavailable = splitReason(direction);
							return (
								<ContextMenuItem
									key={direction}
									disabled={unavailable !== null}
									title={unavailable ?? undefined}
									onSelect={() => {
										if (location.area !== "center" || tab.kind === "tool") return;
										const result = splitCenterGroup(document, location.groupId, direction, tab);
										if (!isLayoutUnavailable(result)) onApply(result);
									}}
								>
									{unavailable ? `Split ${direction} — ${unavailable}` : `Split ${direction}`}
								</ContextMenuItem>
							);
						})}
					</>
				) : null}
				{moveTargets.length > 0 ? <ContextMenuSeparator /> : null}
				{moveTargets.map((group) => {
					const separate = group.location.area !== "center" && !canJoinAuxiliaryGroup(group, tab);
					const label = `Move to ${group.location.area} pane ${describeLayoutGroup(group.tabs)}`;
					return (
						<ContextMenuItem
							key={tupleKey("move-target", group.location.area, group.location.groupId)}
							disabled={separate}
							title={separate ? SEPARATE_PANES_REASON : undefined}
							onSelect={() => move(group.location)}
						>
							{separate ? `${label} — ${SEPARATE_PANES_REASON}` : label}
						</ContextMenuItem>
					);
				})}
				{currentAuxiliary &&
				currentAuxiliaryGroupIndex >= 0 &&
				(tab.kind === "terminal" || tab.kind === "tool") ? (
					<>
						<ContextMenuSeparator />
						{(["before", "after"] as const).map((position) => {
							const insertAt = currentAuxiliaryGroupIndex + (position === "after" ? 1 : 0);
							const countAvailable = canCreateAuxiliaryGroup(
								document,
								currentAuxiliary,
								tab,
								currentAuxiliaryLimit,
							);
							const available = canCreateAuxiliaryGroup(
								document,
								currentAuxiliary,
								tab,
								currentAuxiliaryLimit,
								insertAt,
							);
							const unavailable = countAvailable
								? "already at this position"
								: `limited to ${currentAuxiliaryLimit}`;
							const positionLabel =
								currentAuxiliary === "bottom"
									? position === "before"
										? "left"
										: "right"
									: position === "before"
										? "above"
										: "below";
							return (
								<ContextMenuItem
									key={position}
									disabled={!available}
									title={available ? undefined : unavailable}
									onSelect={() => {
										const result = createAuxiliaryGroup(
											document,
											currentAuxiliary,
											tab,
											insertAt,
											currentAuxiliaryLimit,
										);
										if (!isLayoutUnavailable(result)) onApply(result);
									}}
								>
									New group {positionLabel}
									{available ? "" : ` — ${unavailable}`}
								</ContextMenuItem>
							);
						})}
					</>
				) : null}
				{tab.kind === "terminal" || tab.kind === "tool" ? (
					<>
						<ContextMenuSeparator />
						{(["left", "right", "bottom"] as const).map((region) => {
							const limit = region === "bottom" ? maxBottomGroups : maxSideGroups;
							const countAvailable = canCreateAuxiliaryGroup(document, region, tab, limit);
							const startAvailable = canCreateAuxiliaryGroup(document, region, tab, limit, 0);
							const endIndex = document[region].groups.length;
							const endAvailable = canCreateAuxiliaryGroup(document, region, tab, limit, endIndex);
							const unavailableSuffix = (available: boolean, edge: "start" | "end") =>
								available ? null : countAvailable ? `already at ${edge}` : `limited to ${limit}`;
							const startUnavailable = unavailableSuffix(startAvailable, "start");
							const endUnavailable = unavailableSuffix(endAvailable, "end");
							return (
								<Fragment key={region}>
									<ContextMenuItem
										disabled={!startAvailable}
										title={startUnavailable ?? undefined}
										onSelect={() => {
											const result = createAuxiliaryGroup(document, region, tab, 0, limit);
											if (!isLayoutUnavailable(result)) onApply(result);
										}}
									>
										New {region} group at {region === "bottom" ? "left" : "top"}
										{startUnavailable ? ` — ${startUnavailable}` : ""}
									</ContextMenuItem>
									<ContextMenuItem
										disabled={!endAvailable}
										title={endUnavailable ?? undefined}
										onSelect={() => {
											const result = createAuxiliaryGroup(document, region, tab, endIndex, limit);
											if (!isLayoutUnavailable(result)) onApply(result);
										}}
									>
										New {region} group at {region === "bottom" ? "right" : "bottom"}
										{endUnavailable ? ` — ${endUnavailable}` : ""}
									</ContextMenuItem>
								</Fragment>
							);
						})}
					</>
				) : null}
				{location.area !== "center" && missingTools.length > 0 ? (
					<>
						<ContextMenuSeparator />
						{missingTools.map((tool) => (
							<ContextMenuItem key={tool} onSelect={() => onRevealTool(tool)}>
								Show {toolTab(tool).name}
							</ContextMenuItem>
						))}
					</>
				) : null}
				<ContextMenuSeparator />
				{location.area !== "center" ? (
					<ContextMenuItem onSelect={() => onHideSide(location.area)}>
						{location.area === "bottom" ? "Hide bottom panel" : `Hide ${location.area} side`}
					</ContextMenuItem>
				) : null}
				<ContextMenuItem
					disabled={isLayoutUnavailable(groupRemoval)}
					title={isLayoutUnavailable(groupRemoval) ? groupRemoval.reason : undefined}
					onSelect={() => {
						if (!isLayoutUnavailable(groupRemoval)) onApply(groupRemoval);
					}}
				>
					{isLayoutUnavailable(groupRemoval)
						? `Remove group — ${groupRemoval.reason}`
						: "Remove group"}
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={onClose}
					className="text-feedback-error focus:text-feedback-error"
				>
					{rail ? "Remove tool from group" : "Close"}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
});
WorkbenchTab.displayName = "WorkbenchTab";
