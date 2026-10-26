import { useDraggable, useDroppable } from "@dnd-kit/core";
import { RiSearchLine as Search, RiCloseLine as X } from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
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
import { chatLabel, DOUBLE_CLICK_SETTLE_MS, type LayoutAttention, tupleKey } from "../../lib";
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
	separatePanesReason,
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
	chatFirstPrompts?: WorkbenchProps["chatFirstPrompts"];
	canFocusAdjacentGroup: boolean;
	renderTabAdornment: WorkbenchProps["renderTabAdornment"];
	splitGeometry?: { horizontal: boolean; vertical: boolean };
	trailing?: ReactNode;
}

const GROUP_TABS_LABELS = {
	center: "workbench.tabs.centerGroupTabs",
	left: "workbench.tabs.leftGroupTabs",
	right: "workbench.tabs.rightGroupTabs",
	bottom: "workbench.tabs.bottomGroupTabs",
} as const satisfies Record<LayoutGroupLocation["area"], MessageKey>;

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
	chatFirstPrompts,
	canFocusAdjacentGroup,
	renderTabAdornment,
	splitGeometry,
	trailing,
}: TabStripProps) {
	const t = useT();
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
					aria-label={t(GROUP_TABS_LABELS[location.area])}
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
							{...(chatFirstPrompts ? { chatFirstPrompts } : {})}
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
							label={t("workbench.tabs.insertAtEnd")}
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
					<IconTooltip label={t("workbench.tabs.search")} wrapTrigger>
						<PopoverTrigger
							aria-label={t("workbench.tabs.search")}
							className="flex w-panel-header-row shrink-0 items-center justify-center border-border-muted border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
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
							<CommandInput placeholder={t("workbench.tabs.findPlaceholder")} />
							<CommandList>
								<CommandEmpty>{t("workbench.tabs.noMatches")}</CommandEmpty>
								{tabs.map((tab) => (
									<CommandItem
										key={tab.id}
										value={tab.id}
										keywords={tabSearchKeywords(t, tab, chatFirstPrompts)}
										onSelect={() => {
											overflowFocusTarget.current = tab.id;
											selectTab(tab.id);
											setOverflowOpen(false);
										}}
									>
										{tabIcon(tab)}
										<span className="truncate">{layoutTabName(t, tab, chatFirstPrompts)}</span>
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
	chatFirstPrompts?: WorkbenchProps["chatFirstPrompts"];
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
	chatFirstPrompts,
	canFocusAdjacentGroup,
	renderTabAdornment,
	draggingTab,
	panelId,
	splitGeometry,
	onKeyDown,
}: WorkbenchTabProps) {
	const t = useT();
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
		if (pendingPreviewKeep.current) clearTimeout(pendingPreviewKeep.current);
		pendingPreviewKeep.current = null;
		if (!preview || !active) {
			onSelect(tab.id);
			return;
		}
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
			onSelect(tab.id, true);
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
		if (location.area !== "center") return t("workbench.tab.splitCenterOnly");
		if (tab.kind === "tool") return t("workbench.layout.toolsStayInSide");
		if (collectCenterGroups(document.center).length >= LAYOUT_LIMITS.maxCenterGroups) {
			return t("workbench.layout.centerGroupLimit", { limit: LAYOUT_LIMITS.maxCenterGroups });
		}
		const horizontal = direction === "left" || direction === "right";
		if (splitGeometry && !(horizontal ? splitGeometry.horizontal : splitGeometry.vertical)) {
			return horizontal
				? t("workbench.tab.splitNeedsWidth", { size: LAYOUT_LIMITS.minCenterWidth * 2 })
				: t("workbench.tab.splitNeedsHeight", { size: LAYOUT_LIMITS.minCenterHeight * 2 });
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
	const name = layoutTabName(t, tab, chatFirstPrompts);
	const chatTitle =
		tab.kind === "chat" ? chatLabel(t, tab.name, chatFirstPrompts?.[tab.sessionId]) : undefined;
	const groupRemoval = removeLayoutGroup(t, document, location);

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
			title={
				rail ? undefined : preview ? t("workbench.tab.previewTitle") : (chatTitle?.tooltip ?? name)
			}
			onFocus={rail?.onFocus}
			onClick={rail ? rail.onActivate : selectFromClick}
			onDoubleClick={rail ? undefined : selectFromDoubleClick}
			onKeyDown={onKeyDown}
			className={
				rail
					? RAIL_ENTRY_BUTTON_CLASS
					: cn(
							"relative flex min-w-0 flex-1 items-center gap-4 self-stretch pl-8 text-left outline-none",
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
					data-title-source={chatTitle?.source}
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
						data-drop-label={acceptsBefore ? t("workbench.tab.insertBefore", { name }) : undefined}
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
						data-drop-label={acceptsAfter ? t("workbench.tab.insertAfter", { name }) : undefined}
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
								aria-label={t("workbench.tab.chatName")}
								defaultValue={tab.name}
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
							aria-label={t("workbench.tab.closeNamed", { name })}
							onClick={onClose}
							className="mr-4 rounded-sm p-2 opacity-0 hover:bg-control-bg-hovered group-hover:opacity-100 focus:opacity-100"
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
				<ContextMenuItem onSelect={() => focusTab()}>{t("workbench.tab.focus")}</ContextMenuItem>
				{tab.kind === "chat" && onRenameChat ? (
					<ContextMenuItem
						onSelect={() => {
							editStartNameRef.current = tab.name;
							cancelNextBlurRef.current = false;
							restoreTabFocusRef.current = false;
							enterRenameRef.current = true;
							setEditingName(true);
						}}
					>
						{t("workbench.tab.renameChat")}
					</ContextMenuItem>
				) : null}
				<ContextMenuItem
					disabled={!canFocusAdjacentGroup}
					onSelect={() => onFocusAdjacentGroup(-1, location.groupId)}
				>
					{canFocusAdjacentGroup
						? t("workbench.tab.focusPreviousGroup")
						: t("workbench.tab.focusPreviousGroupUnavailable")}
				</ContextMenuItem>
				<ContextMenuItem
					disabled={!canFocusAdjacentGroup}
					onSelect={() => onFocusAdjacentGroup(1, location.groupId)}
				>
					{canFocusAdjacentGroup
						? t("workbench.tab.focusNextGroup")
						: t("workbench.tab.focusNextGroupUnavailable")}
				</ContextMenuItem>
				{location.area === "center" ? (
					<ContextMenuItem disabled={!preview} onSelect={() => focusTab(true)}>
						{preview ? t("workbench.tab.keepPreview") : t("workbench.tab.keepPreviewUnavailable")}
					</ContextMenuItem>
				) : null}
				<ContextMenuItem
					disabled={previousIndex === undefined}
					onSelect={() => {
						if (previousIndex !== undefined) reorder(previousIndex);
					}}
				>
					{previousIndex === undefined
						? t(rail?.vertical ? "workbench.tab.moveUpFirst" : "workbench.tab.moveLeftFirst")
						: t(rail?.vertical ? "workbench.tab.moveUp" : "workbench.tab.moveLeft")}
				</ContextMenuItem>
				<ContextMenuItem
					disabled={nextIndex === undefined}
					onSelect={() => {
						if (nextIndex !== undefined) reorder(nextIndex);
					}}
				>
					{nextIndex === undefined
						? t(rail?.vertical ? "workbench.tab.moveDownLast" : "workbench.tab.moveRightLast")
						: t(rail?.vertical ? "workbench.tab.moveDown" : "workbench.tab.moveRight")}
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
									{unavailable
										? t("workbench.menu.unavailable", {
												label: t(SPLIT_LABELS[direction]),
												reason: unavailable,
											})
										: t(SPLIT_LABELS[direction])}
								</ContextMenuItem>
							);
						})}
					</>
				) : null}
				{moveTargets.length > 0 ? <ContextMenuSeparator /> : null}
				{moveTargets.map((group) => {
					const separate = group.location.area !== "center" && !canJoinAuxiliaryGroup(group, tab);
					const label = t(MOVE_TO_PANE_LABELS[group.location.area], {
						group: describeLayoutGroup(t, group.tabs, chatFirstPrompts),
					});
					return (
						<ContextMenuItem
							key={tupleKey("move-target", group.location.area, group.location.groupId)}
							disabled={separate}
							title={separate ? separatePanesReason(t) : undefined}
							onSelect={() => move(group.location)}
						>
							{separate
								? t("workbench.menu.unavailable", { label, reason: separatePanesReason(t) })
								: label}
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
								? t("workbench.tab.alreadyAtPosition")
								: t("workbench.tab.limitedTo", { limit: currentAuxiliaryLimit });
							const positionLabel =
								currentAuxiliary === "bottom"
									? position === "before"
										? t("workbench.tab.newGroupLeft")
										: t("workbench.tab.newGroupRight")
									: position === "before"
										? t("workbench.tab.newGroupAbove")
										: t("workbench.tab.newGroupBelow");
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
									{available
										? positionLabel
										: t("workbench.menu.unavailable", {
												label: positionLabel,
												reason: unavailable,
											})}
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
								available
									? null
									: countAvailable
										? t(
												edge === "start"
													? "workbench.tab.alreadyAtStart"
													: "workbench.tab.alreadyAtEnd",
											)
										: t("workbench.tab.limitedTo", { limit });
							const startLabel = t(NEW_REGION_GROUP_LABELS[region].start);
							const endLabel = t(NEW_REGION_GROUP_LABELS[region].end);
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
										{startUnavailable
											? t("workbench.menu.unavailable", {
													label: startLabel,
													reason: startUnavailable,
												})
											: startLabel}
									</ContextMenuItem>
									<ContextMenuItem
										disabled={!endAvailable}
										title={endUnavailable ?? undefined}
										onSelect={() => {
											const result = createAuxiliaryGroup(document, region, tab, endIndex, limit);
											if (!isLayoutUnavailable(result)) onApply(result);
										}}
									>
										{endUnavailable
											? t("workbench.menu.unavailable", { label: endLabel, reason: endUnavailable })
											: endLabel}
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
								{t("workbench.tab.showTool", { name: layoutTabName(t, toolTab(tool)) })}
							</ContextMenuItem>
						))}
					</>
				) : null}
				<ContextMenuSeparator />
				{location.area !== "center" ? (
					<ContextMenuItem onSelect={() => onHideSide(location.area)}>
						{location.area === "bottom"
							? t("workbench.bottom.hide")
							: t(
									location.area === "left"
										? "workbench.tab.hideLeftSide"
										: "workbench.tab.hideRightSide",
								)}
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
						? t("workbench.menu.unavailable", {
								label: t("workbench.group.remove"),
								reason: groupRemoval.reason,
							})
						: t("workbench.group.remove")}
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={onClose}
					className="text-feedback-error focus:text-feedback-error"
				>
					{rail ? t("workbench.tab.removeToolFromGroup") : t("common.close")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
});
WorkbenchTab.displayName = "WorkbenchTab";
