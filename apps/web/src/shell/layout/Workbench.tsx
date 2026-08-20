import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	MeasuringStrategy,
	PointerSensor,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import type {
	LayoutCenterGroup,
	LayoutCenterNode,
	LayoutCenterSplit,
	LayoutCenterTab,
	LayoutSideGroup,
	LayoutSideTab,
	LayoutTab,
	LayoutToolId,
	WorkspaceLayoutDocument,
} from "@thinkrail/contracts";
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	File,
	GitCompareArrows,
	ListTodo,
	MessageSquare,
	MessageSquarePlus,
	MoreHorizontal,
	PanelLeftOpen,
	PanelRightOpen,
	PanelsTopLeft,
	SquareTerminal,
	X,
} from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "../../components/ui/command";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import {
	type ImperativePanelGroupHandle,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "../../components/ui/resizable";
import {
	DOUBLE_CLICK_SETTLE_MS,
	type LayoutAttention,
	readLayoutNavigationClock,
	readLayoutSelection,
	tupleKey,
} from "../../lib";
import {
	type CenterSplitDirection,
	canCreateSideGroup,
	canPlaceLayoutTab,
	canShowSide,
	closePlacedResource,
	collectAllGroups,
	collectCenterGroups,
	createLayoutId,
	createSideGroup,
	findCenterGroup,
	findPlacedResource,
	findTabLocation,
	hideSide,
	isLayoutUnavailable,
	keepPreview,
	LAYOUT_LIMITS,
	LAYOUT_TOOLS,
	type LayoutGroupLocation,
	type LayoutMutationResult,
	type LayoutOperationResult,
	type LayoutSide,
	moveTabToGroup,
	reconcileAttention,
	resizeCenterSplit,
	resizeSideGroups,
	resizeSideRegion,
	revealTool,
	selectTab,
	setSideGroupFolded,
	showSide,
	splitCenterGroup,
	toolTab,
} from "./model";

export interface LayoutTabFocusRequest {
	key: string;
	location: LayoutGroupLocation;
	tabId?: string;
}

interface PreparedLayoutClose {
	document: WorkspaceLayoutDocument;
	onAccepted: (currentDocument?: WorkspaceLayoutDocument) => void;
}

export interface WorkbenchProps {
	document: WorkspaceLayoutDocument;
	attention: LayoutAttention;
	maxSideGroups: number;
	remoteEpoch: number;
	focusRequest?: LayoutTabFocusRequest;
	renderTabBody: (tab: LayoutCenterTab | Extract<LayoutSideTab, { kind: "terminal" }>) => ReactNode;
	renderTabAdornment: (tab: LayoutTab) => ReactNode;
	renderToolBody: (tool: LayoutToolId) => ReactNode;
	renderEmptyCenter: (groupId: string) => ReactNode;
	renderCenterActions: (groupId: string) => ReactNode;
	onCommit: (document: WorkspaceLayoutDocument) => void;
	onAttentionChange: (attention: LayoutAttention) => void;
	onUserNavigation: () => void;
	onRequestClose: (
		tab: LayoutTab,
		prepare: (latestDocument?: WorkspaceLayoutDocument) => PreparedLayoutClose,
	) => void;
	onNewChat: (groupId: string) => void;
	onRemoteGestureCanceled?: () => void;
}

type DropTarget =
	| { kind: "group"; location: LayoutGroupLocation }
	| { kind: "insert"; location: LayoutGroupLocation; index: number }
	| { kind: "split"; groupId: string; direction: CenterSplitDirection }
	| { kind: "side-edge"; side: LayoutSide; index: number };

interface DragData {
	tab: LayoutTab;
}

function sameSizes(first: readonly number[], second: readonly number[]): boolean {
	return (
		first.length === second.length &&
		first.every((value, index) => Math.abs(value - (second[index] ?? 0)) < 0.15)
	);
}

function useCommittedSizes(
	current: readonly number[],
	remoteEpoch: number,
	commit: (sizes: number[]) => void,
	onCanceled?: () => void,
): {
	onLayout: (sizes: number[]) => void;
	onDragging: (active: boolean) => void;
	onKeyboard: (event: { key: string }) => void;
	onKeyboardEnd: () => void;
} {
	const dragging = useRef(false);
	const keyboard = useRef(false);
	const pending = useRef<number[] | null>(null);
	const startEpoch = useRef(remoteEpoch);
	const observedEpoch = useRef(remoteEpoch);
	const epoch = useRef(remoteEpoch);
	const currentRef = useRef(current);
	const commitRef = useRef(commit);
	epoch.current = remoteEpoch;
	currentRef.current = current;
	commitRef.current = commit;

	const cancelStaleGesture = useCallback(() => {
		if (startEpoch.current === epoch.current) return false;
		dragging.current = false;
		keyboard.current = false;
		pending.current = null;
		if (observedEpoch.current !== epoch.current) {
			observedEpoch.current = epoch.current;
			onCanceled?.();
		}
		return true;
	}, [onCanceled]);

	useEffect(() => {
		if (observedEpoch.current === remoteEpoch) return;
		if (dragging.current || keyboard.current) {
			cancelStaleGesture();
			return;
		}
		observedEpoch.current = remoteEpoch;
	}, [cancelStaleGesture, remoteEpoch]);

	const flush = useCallback(() => {
		const sizes = pending.current;
		pending.current = null;
		if (!sizes || startEpoch.current !== epoch.current || sameSizes(sizes, currentRef.current))
			return;
		commitRef.current(sizes);
	}, []);

	const onLayout = useCallback(
		(sizes: number[]) => {
			if (cancelStaleGesture() || sameSizes(sizes, currentRef.current)) return;
			if (dragging.current) {
				pending.current = sizes;
				return;
			}
			if (!keyboard.current) return;
			keyboard.current = false;
			pending.current = sizes;
			flush();
		},
		[cancelStaleGesture, flush],
	);

	const onDragging = useCallback(
		(active: boolean) => {
			if (!active && cancelStaleGesture()) return;
			dragging.current = active;
			if (active) {
				startEpoch.current = epoch.current;
				pending.current = null;
				return;
			}
			flush();
		},
		[cancelStaleGesture, flush],
	);
	const onKeyboard = useCallback((event: { key: string }) => {
		if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
		startEpoch.current = epoch.current;
		keyboard.current = true;
	}, []);
	const onKeyboardEnd = useCallback(() => {
		keyboard.current = false;
		pending.current = null;
	}, []);
	return { onLayout, onDragging, onKeyboard, onKeyboardEnd };
}

function useElementSize(): {
	ref: React.RefObject<HTMLDivElement | null>;
	width: number;
	height: number;
} {
	const ref = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return { ref, ...size };
}

function tabSearchKeywords(tab: LayoutTab): string[] {
	switch (tab.kind) {
		case "file":
		case "diff":
			return [tab.name, tab.kind, tab.path];
		case "chat":
			return [tab.name, tab.kind, tab.sessionId];
		case "document":
			return [tab.name, tab.kind, tab.sourceId, tab.docPath];
		case "terminal":
			return [tab.name, tab.kind, tab.tabKey];
		case "tool":
			return [tab.name, tab.kind, tab.tool];
	}
}

function tabIcon(tab: LayoutTab): ReactNode {
	switch (tab.kind) {
		case "file":
			return <File className="size-3.5 shrink-0" />;
		case "diff":
			return <GitCompareArrows className="size-3.5 shrink-0" />;
		case "chat":
			return <MessageSquare className="size-3.5 shrink-0" />;
		case "document":
			return <ListTodo className="size-3.5 shrink-0" />;
		case "terminal":
			return <SquareTerminal className="size-3.5 shrink-0" />;
		case "tool":
			return <PanelsTopLeft className="size-3.5 shrink-0" />;
	}
}

function encodedElementId(namespace: string, ...parts: string[]): string {
	return encodeURIComponent(tupleKey(namespace, ...parts));
}

function groupPanelId(location: LayoutGroupLocation): string {
	return encodedElementId("layout-panel", location.area, location.groupId);
}

function tabDomId(location: LayoutGroupLocation, tabId: string): string {
	return encodedElementId("layout-tab", location.area, location.groupId, tabId);
}

function groupDomId(location: LayoutGroupLocation): string {
	return encodedElementId("layout-group", location.area, location.groupId);
}

function navigationClockSnapshot(attention: LayoutAttention): string {
	return JSON.stringify(
		Object.keys(attention.navigationClockByGroup)
			.sort()
			.map((groupId) => [groupId, readLayoutNavigationClock(attention, groupId) ?? 0]),
	);
}

function visibleFocusableGroups(document: WorkspaceLayoutDocument): Array<{
	location: LayoutGroupLocation;
	tabs: LayoutTab[];
}> {
	return [
		...(document.left.visible
			? document.left.groups.map((group) => ({
					location: { area: "left" as const, groupId: group.id },
					tabs: group.tabs,
				}))
			: []),
		...collectCenterGroups(document.center).map((group) => ({
			location: { area: "center" as const, groupId: group.id },
			tabs: group.tabs,
		})),
		...(document.right.visible
			? document.right.groups.map((group) => ({
					location: { area: "right" as const, groupId: group.id },
					tabs: group.tabs,
				}))
			: []),
	];
}

function canInsertDraggedTab(
	document: WorkspaceLayoutDocument,
	tab: LayoutTab,
	location: LayoutGroupLocation,
	rawIndex: number,
): boolean {
	if (!canPlaceLayoutTab(tab, location.area)) return false;
	const source = findTabLocation(document, tab.id);
	if (!source || source.area !== location.area || source.groupId !== location.groupId) return true;
	const sourceTabs = findLayoutGroupTabs(document, source);
	const sourceIndex = sourceTabs?.findIndex((candidate) => candidate.id === tab.id) ?? -1;
	if (sourceIndex < 0) return true;
	const insertionIndex = sourceIndex < rawIndex ? rawIndex - 1 : rawIndex;
	return insertionIndex !== sourceIndex;
}

function DropZone({
	id,
	target,
	className,
	label,
}: {
	id: string;
	target: DropTarget;
	className: string;
	label: string;
}) {
	const { setNodeRef, isOver } = useDroppable({ id, data: { target } });
	return (
		<div
			ref={setNodeRef}
			aria-hidden="true"
			data-drop-active={isOver || undefined}
			data-drop-label={label}
			className={`pointer-events-auto z-20 rounded-[var(--radius-sm)] border border-transparent transition-colors data-[drop-active]:border-primary data-[drop-active]:bg-primary-subtle ${className}`}
		/>
	);
}

interface TabStripProps {
	document: WorkspaceLayoutDocument;
	attention: LayoutAttention;
	selectionEpoch: React.MutableRefObject<number>;
	location: LayoutGroupLocation;
	tabs: LayoutTab[];
	selectedId?: string | undefined;
	previewId?: string | undefined;
	maxSideGroups: number;
	draggingTab: LayoutTab | null;
	onSelect: (tabId: string, keep?: boolean) => void;
	onClose: (tab: LayoutTab) => void;
	onApply: (result: LayoutMutationResult) => void;
	onFocusAdjacentGroup: (delta: -1 | 1, fromGroupId?: string) => void;
	onHideSide: (side: LayoutSide) => void;
	onRevealTool: (tool: LayoutToolId) => void;
	canFocusAdjacentGroup: boolean;
	renderTabAdornment: WorkbenchProps["renderTabAdornment"];
	splitGeometry?: { horizontal: boolean; vertical: boolean };
	trailing?: ReactNode;
}

function TabStrip({
	document,
	attention,
	selectionEpoch,
	location,
	tabs,
	selectedId,
	previewId,
	maxSideGroups,
	draggingTab,
	onSelect,
	onClose,
	onApply,
	onFocusAdjacentGroup,
	onHideSide,
	onRevealTool,
	canFocusAdjacentGroup,
	renderTabAdornment,
	splitGeometry,
	trailing,
}: TabStripProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const tabRefs = useRef(new Map<string, HTMLButtonElement>());
	const overflowFocusTarget = useRef<string | null>(null);
	const [overflowOpen, setOverflowOpen] = useState(false);
	const selectTab = (tabId: string, keep?: boolean) => {
		selectionEpoch.current += 1;
		onSelect(tabId, keep);
	};
	const applyResult = (result: LayoutMutationResult) => {
		selectionEpoch.current += 1;
		onApply(result);
	};
	const closeTab = (tab: LayoutTab) => {
		selectionEpoch.current += 1;
		onClose(tab);
	};
	const acceptsAppend =
		draggingTab !== null && canInsertDraggedTab(document, draggingTab, location, tabs.length);
	const panelId = groupPanelId(location);
	const groupDrop = useDroppable({
		id: tupleKey("dnd-group", location.area, location.groupId),
		data: { target: { kind: "group", location } satisfies DropTarget },
		disabled: !acceptsAppend,
	});

	useEffect(() => {
		if (selectedId)
			tabRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [selectedId]);

	const selectAt = (index: number) => {
		const tab = tabs[index];
		if (!tab) return;
		selectTab(tab.id);
		requestAnimationFrame(() => tabRefs.current.get(tab.id)?.focus());
	};

	const compatibilityTestId =
		location.area === "center"
			? "center-tab-strip"
			: tabs.some((tab) => tab.kind === "tool" && tab.tool === "specs")
				? "right-tab-strip"
				: "workbench-tab-strip";
	return (
		<div
			ref={groupDrop.setNodeRef}
			data-testid={compatibilityTestId}
			data-area={location.area}
			data-group-id={location.groupId}
			data-drop-active={groupDrop.isOver || undefined}
			className="relative flex h-panel-header-row shrink-0 items-stretch border-border-default border-b bg-container-workspace-bg data-[drop-active]:bg-primary-subtle"
		>
			<button
				type="button"
				aria-label="Scroll tabs left"
				onClick={() => scroller.current?.scrollBy({ left: -180, behavior: "smooth" })}
				className="flex w-6 shrink-0 items-center justify-center border-border-muted border-r text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				<ChevronLeft className="size-3.5" />
			</button>
			<div
				ref={scroller}
				role="tablist"
				aria-label={`${location.area} group tabs`}
				className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
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
						location={location}
						attention={attention}
						selectionEpoch={selectionEpoch}
						active={tab.id === selectedId}
						preview={tab.id === previewId}
						document={document}
						maxSideGroups={maxSideGroups}
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
						id={tupleKey("dnd-insert", location.area, location.groupId, String(tabs.length), "end")}
						target={{ kind: "insert", location, index: tabs.length }}
						label="Insert at end"
						className="relative h-full w-5 shrink-0"
					/>
				) : null}
			</div>
			{trailing}
			<button
				type="button"
				aria-label="Scroll tabs right"
				onClick={() => scroller.current?.scrollBy({ left: 180, behavior: "smooth" })}
				className="flex w-6 shrink-0 items-center justify-center border-border-muted border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				<ChevronRight className="size-3.5" />
			</button>
			<Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
				<PopoverTrigger
					aria-label="Search open tabs"
					className="flex w-7 shrink-0 items-center justify-center border-border-muted border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<MoreHorizontal className="size-4" />
				</PopoverTrigger>
				<PopoverContent
					align="end"
					className="w-72 p-0"
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
									<span className="truncate">{tab.name}</span>
								</CommandItem>
							))}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}

interface WorkbenchTabProps {
	tab: LayoutTab;
	index: number;
	location: LayoutGroupLocation;
	attention: LayoutAttention;
	selectionEpoch: React.MutableRefObject<number>;
	active: boolean;
	preview: boolean;
	document: WorkspaceLayoutDocument;
	maxSideGroups: number;
	register: (node: HTMLButtonElement | null) => void;
	onSelect: (tabId: string, keep?: boolean) => void;
	onClose: () => void;
	onApply: (result: LayoutMutationResult) => void;
	onFocusAdjacentGroup: (delta: -1 | 1, fromGroupId?: string) => void;
	onHideSide: (side: LayoutSide) => void;
	onRevealTool: (tool: LayoutToolId) => void;
	canFocusAdjacentGroup: boolean;
	renderTabAdornment: WorkbenchProps["renderTabAdornment"];
	draggingTab: LayoutTab | null;
	panelId: string;
	splitGeometry?: { horizontal: boolean; vertical: boolean };
	onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

function WorkbenchTab({
	tab,
	index,
	location,
	attention,
	selectionEpoch,
	active,
	preview,
	document,
	maxSideGroups,
	register,
	onSelect,
	onClose,
	onApply,
	onFocusAdjacentGroup,
	onHideSide,
	onRevealTool,
	canFocusAdjacentGroup,
	renderTabAdornment,
	draggingTab,
	panelId,
	splitGeometry,
	onKeyDown,
}: WorkbenchTabProps) {
	const drag = useDraggable({ id: tupleKey("dnd-tab", tab.id), data: { tab } satisfies DragData });
	const attentionRef = useRef(attention);
	attentionRef.current = attention;
	const pendingPreviewKeep = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (pendingPreviewKeep.current) clearTimeout(pendingPreviewKeep.current);
		},
		[],
	);
	const selectFromClick = () => {
		if (!preview) {
			onSelect(tab.id);
			return;
		}
		// Wait out the browser's double-click window for every preview tab. Otherwise an inactive preview's
		// leading click publishes a select before `dblclick` can upgrade the gesture to one final keep.
		if (pendingPreviewKeep.current) clearTimeout(pendingPreviewKeep.current);
		const gestureEpoch = ++selectionEpoch.current;
		const navigationClocks = navigationClockSnapshot(attentionRef.current);
		pendingPreviewKeep.current = setTimeout(() => {
			pendingPreviewKeep.current = null;
			if (
				selectionEpoch.current !== gestureEpoch ||
				navigationClockSnapshot(attentionRef.current) !== navigationClocks
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
	const acceptsBefore =
		draggingTab !== null && canInsertDraggedTab(document, draggingTab, location, index);
	const acceptsAfter =
		draggingTab !== null && canInsertDraggedTab(document, draggingTab, location, index + 1);
	const before = useDroppable({
		id: tupleKey("dnd-insert", location.area, location.groupId, String(index), "before"),
		data: { target: { kind: "insert", location, index } satisfies DropTarget },
		disabled: !acceptsBefore,
	});
	const after = useDroppable({
		id: tupleKey("dnd-insert", location.area, location.groupId, String(index + 1), "after"),
		data: { target: { kind: "insert", location, index: index + 1 } satisfies DropTarget },
		disabled: !acceptsAfter,
	});
	const groups = collectAllGroups(document);
	const missingTools = LAYOUT_TOOLS.filter((tool) => !findPlacedResource(document, toolTab(tool)));
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
	const currentSide = location.area === "center" ? null : location.area;
	const currentSideGroupIndex = currentSide
		? document[currentSide].groups.findIndex((group) => group.id === location.groupId)
		: -1;

	const move = (target: LayoutGroupLocation, targetIndex?: number) => {
		const result = moveTabToGroup(document, tab, target, targetIndex);
		if (!isLayoutUnavailable(result)) onApply(result);
	};
	const reorder = (nextIndex: number) => move(location, nextIndex);
	const focusTab = (keep?: boolean) => {
		onSelect(tab.id, keep);
		requestAnimationFrame(() =>
			globalThis.document.getElementById(tabDomId(location, tab.id))?.focus(),
		);
	};

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
					ref={drag.setNodeRef}
					role="presentation"
					data-testid={tabTestId}
					data-active={active}
					data-preview={preview}
					data-kind={tab.kind === "document" ? "plan" : tab.kind}
					data-dragging={drag.isDragging || undefined}
					className="group relative flex min-w-24 max-w-48 shrink-0 items-center border-border-default border-r text-text-muted after:pointer-events-none after:absolute after:right-xs after:bottom-0 after:left-xs after:z-10 after:h-[2px] after:rounded-full after:content-[''] data-[active=true]:bg-control-bg-selected data-[active=true]:text-text-default data-[active=true]:after:bg-primary data-[dragging]:opacity-40"
				>
					<div
						ref={before.setNodeRef}
						aria-hidden="true"
						data-drop-label={acceptsBefore ? `Insert before ${tab.name}` : undefined}
						data-drop-active={before.isOver || undefined}
						className="pointer-events-none absolute inset-y-0 left-0 z-10 w-1/2 border-primary data-[drop-active]:border-l-2"
					/>
					<div
						ref={after.setNodeRef}
						aria-hidden="true"
						data-drop-label={acceptsAfter ? `Insert after ${tab.name}` : undefined}
						data-drop-active={after.isOver || undefined}
						className="pointer-events-none absolute inset-y-0 right-0 z-10 w-1/2 border-primary data-[drop-active]:border-r-2"
					/>
					<button
						ref={register}
						type="button"
						id={tabDomId(location, tab.id)}
						role="tab"
						aria-selected={active}
						aria-keyshortcuts="Delete Home End ArrowLeft ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Control+F6 Control+Shift+F6"
						aria-controls={panelId}
						data-layout-tab-id={tab.id}
						tabIndex={active ? 0 : -1}
						{...drag.listeners}
						title={preview ? "Preview — double-click to keep" : tab.name}
						onClick={selectFromClick}
						onDoubleClick={selectFromDoubleClick}
						onKeyDown={onKeyDown}
						className="flex min-w-0 flex-1 items-center gap-xs py-xs pl-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
					>
						{tabIcon(tab)}
						<span className={`truncate ${preview ? "italic" : ""}`}>{tab.name}</span>
						{renderTabAdornment(tab)}
					</button>
					<button
						type="button"
						tabIndex={-1}
						data-testid={tab.kind === "terminal" ? "terminal-tab-close" : "editor-tab-close"}
						aria-label={`Close ${tab.name}`}
						onClick={onClose}
						className="mr-xs rounded-[var(--radius-sm)] p-0.5 opacity-0 hover:bg-control-bg-hovered group-hover:opacity-100 focus:opacity-100"
					>
						<X className="size-3.5" />
					</button>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => focusTab()}>Focus tab</ContextMenuItem>
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
				<ContextMenuItem disabled={!preview} onSelect={() => focusTab(true)}>
					{preview ? "Keep preview" : "Keep preview — already kept"}
				</ContextMenuItem>
				<ContextMenuItem disabled={index === 0} onSelect={() => reorder(index - 1)}>
					{index === 0 ? "Move left — already first" : "Move left"}
				</ContextMenuItem>
				<ContextMenuItem
					disabled={index === (findLayoutGroupTabs(document, location)?.length ?? 0) - 1}
					onSelect={() => reorder(index + 1)}
				>
					{index === (findLayoutGroupTabs(document, location)?.length ?? 0) - 1
						? "Move right — already last"
						: "Move right"}
				</ContextMenuItem>
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
				{moveTargets.length > 0 ? <ContextMenuSeparator /> : null}
				{moveTargets.map((group) => (
					<ContextMenuItem
						key={tupleKey("move-target", group.location.area, group.location.groupId)}
						onSelect={() => move(group.location)}
					>
						Move to {group.location.area} group {group.location.groupId.slice(-4)}
					</ContextMenuItem>
				))}
				{currentSide &&
				currentSideGroupIndex >= 0 &&
				(tab.kind === "terminal" || tab.kind === "tool") ? (
					<>
						<ContextMenuSeparator />
						{(["above", "below"] as const).map((position) => {
							const insertAt = currentSideGroupIndex + (position === "below" ? 1 : 0);
							const countAvailable = canCreateSideGroup(document, currentSide, tab, maxSideGroups);
							const available = canCreateSideGroup(
								document,
								currentSide,
								tab,
								maxSideGroups,
								insertAt,
							);
							const unavailable = countAvailable
								? "already at this position"
								: `limited to ${maxSideGroups}`;
							return (
								<ContextMenuItem
									key={position}
									disabled={!available}
									title={available ? undefined : unavailable}
									onSelect={() => {
										const result = createSideGroup(
											document,
											currentSide,
											tab,
											insertAt,
											maxSideGroups,
										);
										if (!isLayoutUnavailable(result)) onApply(result);
									}}
								>
									New group {position}
									{available ? "" : ` — ${unavailable}`}
								</ContextMenuItem>
							);
						})}
					</>
				) : null}
				{tab.kind === "terminal" || tab.kind === "tool" ? (
					<>
						<ContextMenuSeparator />
						{(["left", "right"] as const).map((side) => {
							const countAvailable = canCreateSideGroup(document, side, tab, maxSideGroups);
							const topAvailable = canCreateSideGroup(document, side, tab, maxSideGroups, 0);
							const bottomIndex = document[side].groups.length;
							const bottomAvailable = canCreateSideGroup(
								document,
								side,
								tab,
								maxSideGroups,
								bottomIndex,
							);
							const unavailableSuffix = (available: boolean, edge: "top" | "bottom") =>
								available
									? null
									: countAvailable
										? `already at ${edge}`
										: `limited to ${maxSideGroups}`;
							const topUnavailable = unavailableSuffix(topAvailable, "top");
							const bottomUnavailable = unavailableSuffix(bottomAvailable, "bottom");
							return (
								<Fragment key={side}>
									<ContextMenuItem
										disabled={!topAvailable}
										title={topUnavailable ?? undefined}
										onSelect={() => {
											const result = createSideGroup(document, side, tab, 0, maxSideGroups);
											if (!isLayoutUnavailable(result)) onApply(result);
										}}
									>
										New {side} group at top
										{topUnavailable ? ` — ${topUnavailable}` : ""}
									</ContextMenuItem>
									<ContextMenuItem
										disabled={!bottomAvailable}
										title={bottomUnavailable ?? undefined}
										onSelect={() => {
											const result = createSideGroup(
												document,
												side,
												tab,
												bottomIndex,
												maxSideGroups,
											);
											if (!isLayoutUnavailable(result)) onApply(result);
										}}
									>
										New {side} group
										{bottomUnavailable ? ` — ${bottomUnavailable}` : ""}
									</ContextMenuItem>
								</Fragment>
							);
						})}
					</>
				) : null}
				{missingTools.length > 0 ? (
					<>
						<ContextMenuSeparator />
						{missingTools.map((tool) => (
							<ContextMenuItem key={tool} onSelect={() => onRevealTool(tool)}>
								Restore {toolTab(tool).name}
							</ContextMenuItem>
						))}
					</>
				) : null}
				<ContextMenuSeparator />
				{location.area !== "center" ? (
					<ContextMenuItem onSelect={() => onHideSide(location.area)}>
						Hide {location.area} side
					</ContextMenuItem>
				) : null}
				<ContextMenuItem
					onSelect={onClose}
					className="text-feedback-error focus:text-feedback-error"
				>
					Close
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function findLayoutGroupTabs(
	document: WorkspaceLayoutDocument,
	location: LayoutGroupLocation,
): LayoutTab[] | null {
	if (location.area === "center")
		return findCenterGroup(document.center, location.groupId)?.tabs ?? null;
	return (
		document[location.area].groups.find((group) => group.id === location.groupId)?.tabs ?? null
	);
}

interface SharedGroupProps {
	document: WorkspaceLayoutDocument;
	attention: LayoutAttention;
	selectionEpoch: React.MutableRefObject<number>;
	maxSideGroups: number;
	draggingTab: LayoutTab | null;
	renderTabBody: WorkbenchProps["renderTabBody"];
	renderTabAdornment: WorkbenchProps["renderTabAdornment"];
	onAttentionChange: WorkbenchProps["onAttentionChange"];
	onUserNavigation: WorkbenchProps["onUserNavigation"];
	onRemoteGestureCanceled: (() => void) | undefined;
	onApply: (result: LayoutMutationResult) => void;
	onClose: (tab: LayoutTab) => void;
	onFocusAdjacentGroup: (delta: -1 | 1, fromGroupId?: string) => void;
	onHideSide: (side: LayoutSide) => void;
	onRevealTool: (tool: LayoutToolId) => void;
	canFocusAdjacentGroup: boolean;
}

function CenterGroupView({
	group,
	onNewChat,
	renderEmptyCenter,
	renderCenterActions,
	...shared
}: SharedGroupProps & {
	group: LayoutCenterGroup;
	onNewChat: WorkbenchProps["onNewChat"];
	renderEmptyCenter: WorkbenchProps["renderEmptyCenter"];
	renderCenterActions: WorkbenchProps["renderCenterActions"];
}) {
	const location: LayoutGroupLocation = { area: "center", groupId: group.id };
	const size = useElementSize();
	const splitGeometry = {
		horizontal: size.width >= LAYOUT_LIMITS.minCenterWidth * 2,
		vertical: size.height >= LAYOUT_LIMITS.minCenterHeight * 2,
	};
	const selectedId = readLayoutSelection(shared.attention, group.id);
	const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
	const applySelect = (tabId: string, keep?: boolean) => {
		shared.onUserNavigation();
		const document = shared.document;
		if (keep && group.previewTabId === tabId) {
			const result = keepPreview(document, group.id, tabId);
			if (!isLayoutUnavailable(result)) {
				shared.onApply(result);
				return;
			}
		}
		shared.onAttentionChange(selectTab(shared.attention, location, tabId, true, true));
	};
	return (
		<section
			ref={size.ref}
			id={groupDomId(location)}
			data-testid="center-group"
			data-group-id={group.id}
			tabIndex={-1}
			aria-label={group.tabs.length === 0 ? "Empty center group" : "Center group"}
			className="relative flex h-full min-h-0 min-w-0 flex-col bg-container-content-bg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
			onFocusCapture={() => {
				if (selected)
					shared.onAttentionChange(selectTab(shared.attention, location, selected.id, false));
			}}
		>
			<TabStrip
				document={shared.document}
				attention={shared.attention}
				selectionEpoch={shared.selectionEpoch}
				location={location}
				tabs={group.tabs}
				selectedId={selected?.id}
				previewId={group.previewTabId}
				maxSideGroups={shared.maxSideGroups}
				draggingTab={shared.draggingTab}
				splitGeometry={splitGeometry}
				onSelect={applySelect}
				onClose={shared.onClose}
				onApply={shared.onApply}
				onFocusAdjacentGroup={shared.onFocusAdjacentGroup}
				onHideSide={shared.onHideSide}
				onRevealTool={shared.onRevealTool}
				canFocusAdjacentGroup={shared.canFocusAdjacentGroup}
				renderTabAdornment={shared.renderTabAdornment}
				trailing={
					<>
						{renderCenterActions(group.id)}
						<button
							type="button"
							data-testid="new-chat"
							aria-label="New chat"
							title="New chat"
							onClick={() => onNewChat(group.id)}
							className="flex w-7 shrink-0 items-center justify-center text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							<MessageSquarePlus className="size-4" />
						</button>
					</>
				}
			/>
			<div
				id={groupPanelId(location)}
				data-testid="editor-pane"
				role="tabpanel"
				aria-labelledby={selected ? tabDomId(location, selected.id) : undefined}
				className="relative min-h-0 flex-1 overflow-hidden"
			>
				{selected ? (
					<Fragment key={selected.id}>{shared.renderTabBody(selected)}</Fragment>
				) : (
					renderEmptyCenter(group.id)
				)}
			</div>
			{shared.draggingTab &&
			canPlaceLayoutTab(shared.draggingTab, "center") &&
			collectCenterGroups(shared.document.center).length < LAYOUT_LIMITS.maxCenterGroups ? (
				<div className="pointer-events-none absolute inset-0 z-30">
					{splitGeometry.horizontal ? (
						<>
							<DropZone
								id={tupleKey("dnd-split", group.id, "left")}
								target={{ kind: "split", groupId: group.id, direction: "left" }}
								label="Split left"
								className="absolute inset-y-1/4 left-1 w-1/5"
							/>
							<DropZone
								id={tupleKey("dnd-split", group.id, "right")}
								target={{ kind: "split", groupId: group.id, direction: "right" }}
								label="Split right"
								className="absolute inset-y-1/4 right-1 w-1/5"
							/>
						</>
					) : null}
					{splitGeometry.vertical ? (
						<>
							<DropZone
								id={tupleKey("dnd-split", group.id, "up")}
								target={{ kind: "split", groupId: group.id, direction: "up" }}
								label="Split up"
								className="absolute inset-x-1/4 top-8 h-1/5"
							/>
							<DropZone
								id={tupleKey("dnd-split", group.id, "down")}
								target={{ kind: "split", groupId: group.id, direction: "down" }}
								label="Split down"
								className="absolute inset-x-1/4 bottom-1 h-1/5"
							/>
						</>
					) : null}
				</div>
			) : null}
		</section>
	);
}

type CenterNodeProps = SharedGroupProps & {
	node: LayoutCenterNode;
	remoteEpoch: number;
	onCommit: WorkbenchProps["onCommit"];
	onNewChat: WorkbenchProps["onNewChat"];
	renderEmptyCenter: WorkbenchProps["renderEmptyCenter"];
	renderCenterActions: WorkbenchProps["renderCenterActions"];
};

function CenterNodeView({ node, remoteEpoch, onCommit, onNewChat, ...shared }: CenterNodeProps) {
	return node.kind === "group" ? (
		<CenterGroupView
			key={tupleKey("center-node", node.id)}
			group={node}
			onNewChat={onNewChat}
			{...shared}
		/>
	) : (
		<CenterSplitView
			key={tupleKey("center-node", node.id)}
			node={node}
			remoteEpoch={remoteEpoch}
			onCommit={onCommit}
			onNewChat={onNewChat}
			{...shared}
		/>
	);
}

function CenterSplitView({
	node,
	remoteEpoch,
	onCommit,
	onNewChat,
	...shared
}: Omit<CenterNodeProps, "node"> & { node: LayoutCenterSplit }) {
	const size = useElementSize();
	const weights = node.weights.map((weight) => weight * 100);
	const resize = useCommittedSizes(
		weights,
		remoteEpoch,
		(sizes) => {
			const next = resizeCenterSplit(shared.document, node.id, [sizes[0] ?? 50, sizes[1] ?? 50]);
			if (next !== shared.document) onCommit(next);
		},
		shared.onRemoteGestureCanceled,
	);
	const dimension = node.direction === "horizontal" ? size.width : size.height;
	const minimumPixels =
		node.direction === "horizontal" ? LAYOUT_LIMITS.minCenterWidth : LAYOUT_LIMITS.minCenterHeight;
	const minimumPercent = dimension >= minimumPixels * 2 ? (minimumPixels / dimension) * 100 : 4;
	return (
		<div ref={size.ref} className="h-full min-h-0 min-w-0 overflow-hidden">
			<ResizablePanelGroup
				key={tupleKey("center-split", node.id, String(remoteEpoch))}
				direction={node.direction}
				onLayout={resize.onLayout}
				className="min-h-0 min-w-0"
			>
				<ResizablePanel
					id={tupleKey("center-split-panel", node.id, "0")}
					order={1}
					defaultSize={weights[0]}
					minSize={minimumPercent}
				>
					<CenterNodeView
						node={node.children[0]}
						remoteEpoch={remoteEpoch}
						onCommit={onCommit}
						onNewChat={onNewChat}
						{...shared}
					/>
				</ResizablePanel>
				<ResizableHandle
					direction={node.direction}
					data-testid="center-split-resize"
					disabled={dimension < minimumPixels * 2}
					onDragging={resize.onDragging}
					onKeyDownCapture={resize.onKeyboard}
					onKeyUpCapture={resize.onKeyboardEnd}
				/>
				<ResizablePanel
					id={tupleKey("center-split-panel", node.id, "1")}
					order={2}
					defaultSize={weights[1]}
					minSize={minimumPercent}
				>
					<CenterNodeView
						node={node.children[1]}
						remoteEpoch={remoteEpoch}
						onCommit={onCommit}
						onNewChat={onNewChat}
						{...shared}
					/>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}

function SideGroupView({
	side,
	group,
	groupIndex,
	renderToolBody,
	onFold,
	...shared
}: SharedGroupProps & {
	side: LayoutSide;
	group: LayoutSideGroup;
	groupIndex: number;
	renderToolBody: WorkbenchProps["renderToolBody"];
	onFold: () => void;
}) {
	const location: LayoutGroupLocation = { area: side, groupId: group.id };
	const selectedId = readLayoutSelection(shared.attention, group.id);
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
						target={{ kind: "side-edge", side, index: groupIndex }}
						label={`Create ${side} group above`}
						className="absolute inset-x-1 top-1 bottom-1/2"
					/>
				) : null}
				{canCreateBelow ? (
					<DropZone
						id={tupleKey("dnd-side-group", side, group.id, "below")}
						target={{ kind: "side-edge", side, index: groupIndex + 1 }}
						label={`Create ${side} group below`}
						className="absolute inset-x-1 top-1/2 bottom-1"
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
				if (selected)
					shared.onAttentionChange(selectTab(shared.attention, location, selected.id, false));
			}}
		>
			<div className="flex h-panel-header-row shrink-0 items-stretch">
				<div className="min-w-0 flex-1">
					<TabStrip
						document={shared.document}
						attention={shared.attention}
						selectionEpoch={shared.selectionEpoch}
						location={location}
						tabs={group.tabs}
						selectedId={selected?.id}
						maxSideGroups={shared.maxSideGroups}
						draggingTab={group.folded ? null : shared.draggingTab}
						onSelect={(tabId) =>
							shared.onAttentionChange(selectTab(shared.attention, location, tabId))
						}
						onClose={shared.onClose}
						onApply={shared.onApply}
						onFocusAdjacentGroup={shared.onFocusAdjacentGroup}
						onHideSide={shared.onHideSide}
						onRevealTool={shared.onRevealTool}
						canFocusAdjacentGroup={shared.canFocusAdjacentGroup}
						renderTabAdornment={shared.renderTabAdornment}
					/>
				</div>
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
					className="flex w-7 shrink-0 items-center justify-center border-border-muted border-b border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<ChevronDown
						className={`size-3.5 transition-transform ${group.folded ? "-rotate-90" : ""}`}
					/>
				</button>
			</div>
			<div
				id={groupPanelId(location)}
				role="tabpanel"
				aria-labelledby={selected ? tabDomId(location, selected.id) : undefined}
				hidden={group.folded}
				className="relative min-h-0 flex-1 overflow-auto"
			>
				{!group.folded && selected ? (
					<Fragment key={selected.id}>
						{selected.kind === "tool"
							? renderToolBody(selected.tool)
							: selected.kind === "terminal"
								? shared.renderTabBody(selected)
								: null}
					</Fragment>
				) : null}
				{group.folded ? null : creationTargets}
			</div>
			{group.folded ? creationTargets : null}
		</div>
	);
}

function SideStack({
	side,
	region,
	remoteEpoch,
	renderToolBody,
	onCommit,
	...shared
}: SharedGroupProps & {
	side: LayoutSide;
	region: WorkspaceLayoutDocument[LayoutSide];
	remoteEpoch: number;
	renderToolBody: WorkbenchProps["renderToolBody"];
	onCommit: WorkbenchProps["onCommit"];
}) {
	const size = useElementSize();
	const total = region.groups.reduce((sum, group) => sum + group.weight, 0) || 1;
	const current = region.groups.map((group) => (group.weight / total) * 100);
	const resize = useCommittedSizes(
		current,
		remoteEpoch,
		(sizes) => {
			const next = resizeSideGroups(shared.document, side, sizes);
			if (next !== shared.document) onCommit(next);
		},
		shared.onRemoteGestureCanceled,
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
			ref={size.ref}
			aria-label={`${side} workbench`}
			data-testid={side === "right" ? "right-stack" : "left-stack"}
			className="relative h-full min-h-0 overflow-hidden"
		>
			<ResizablePanelGroup
				key={tupleKey(
					"side-stack",
					side,
					String(remoteEpoch),
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
}

function PanelWithHandle({
	children,
	showHandle,
	handleTestId,
	handleDisabled,
	onDragging,
	onKeyboard,
	onKeyboardEnd,
	...panelProps
}: React.ComponentProps<typeof ResizablePanel> & {
	showHandle: boolean;
	handleTestId: string;
	handleDisabled: boolean;
	onDragging: (active: boolean) => void;
	onKeyboard: (event: { key: string }) => void;
	onKeyboardEnd: () => void;
}) {
	return (
		<>
			<ResizablePanel {...panelProps}>{children}</ResizablePanel>
			{showHandle ? (
				<ResizableHandle
					direction="vertical"
					data-testid={handleTestId}
					disabled={handleDisabled}
					onDragging={onDragging}
					onKeyDownCapture={onKeyboard}
					onKeyUpCapture={onKeyboardEnd}
				/>
			) : null}
		</>
	);
}

function HiddenSideRail({
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
	const drop = useDroppable({
		id: tupleKey("dnd-hidden-side-edge", side),
		data: { target: { kind: "side-edge", side, index: targetIndex } satisfies DropTarget },
		disabled: !dropEnabled,
	});
	return (
		<div
			ref={drop.setNodeRef}
			data-testid={`${side}-layout-rail`}
			data-drop-label={dropEnabled ? `Create ${side} group in hidden side` : undefined}
			data-drop-active={drop.isOver || undefined}
			className="flex w-7 shrink-0 flex-col items-center border-border-default bg-container-sidebar-bg py-xs first:border-r last:border-l data-[drop-active]:bg-primary-subtle data-[drop-active]:ring-2 data-[drop-active]:ring-inset data-[drop-active]:ring-primary"
		>
			<button
				type="button"
				aria-label={`Show ${side} side`}
				title={showEnabled ? `Show ${side} side` : `No ${side} groups to show`}
				disabled={!showEnabled}
				onClick={onShow}
				className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text disabled:hover:bg-transparent"
			>
				{side === "left" ? (
					<PanelLeftOpen className="size-4" />
				) : (
					<PanelRightOpen className="size-4" />
				)}
			</button>
		</div>
	);
}

export function Workbench({
	document,
	attention,
	maxSideGroups,
	remoteEpoch,
	focusRequest,
	renderTabBody,
	renderTabAdornment,
	renderToolBody,
	renderEmptyCenter,
	renderCenterActions,
	onCommit,
	onAttentionChange,
	onUserNavigation,
	onRequestClose,
	onNewChat,
	onRemoteGestureCanceled,
}: WorkbenchProps) {
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
	const [draggingTab, setDraggingTab] = useState<LayoutTab | null>(null);
	const tabSelectionEpoch = useRef(0);
	const selectionRemoteEpoch = useRef(remoteEpoch);
	if (selectionRemoteEpoch.current !== remoteEpoch) {
		selectionRemoteEpoch.current = remoteEpoch;
		tabSelectionEpoch.current += 1;
	}
	const { ref: workbenchRef, width: workbenchWidth } = useElementSize();
	const [focusAfterClose, setFocusAfterClose] = useState<{
		closedTab: LayoutTab;
		fallbackDomId: string;
	} | null>(null);
	const documentRef = useRef(document);
	const attentionRef = useRef(attention);
	documentRef.current = document;
	attentionRef.current = attention;
	const [localFocusRequest, setLocalFocusRequest] = useState<LayoutTabFocusRequest | null>(null);
	const dragStartEpoch = useRef(remoteEpoch);
	const canceled = useRef(false);

	useEffect(() => {
		if (!focusRequest) return;
		const frame = requestAnimationFrame(() => {
			const id = focusRequest.tabId
				? tabDomId(focusRequest.location, focusRequest.tabId)
				: groupDomId(focusRequest.location);
			globalThis.document.getElementById(id)?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [focusRequest]);

	useEffect(() => {
		if (!localFocusRequest) return;
		const frame = requestAnimationFrame(() => {
			const id = localFocusRequest.tabId
				? tabDomId(localFocusRequest.location, localFocusRequest.tabId)
				: groupDomId(localFocusRequest.location);
			globalThis.document.getElementById(id)?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [localFocusRequest]);

	useEffect(() => {
		if (!draggingTab || dragStartEpoch.current === remoteEpoch) return;
		canceled.current = true;
		setDraggingTab(null);
		onRemoteGestureCanceled?.();
	}, [draggingTab, onRemoteGestureCanceled, remoteEpoch]);

	const updateAttentionForResult = useCallback(
		(result: LayoutMutationResult) => {
			let next = reconcileAttention(result.document, attention, document);
			if (result.focusGroupId && result.focusTabId) {
				const location = findTabLocation(result.document, result.focusTabId);
				if (location) next = selectTab(next, location, result.focusTabId, true, true);
			}
			onAttentionChange(next);
		},
		[attention, document, onAttentionChange],
	);

	const apply = useCallback(
		(result: LayoutMutationResult) => {
			updateAttentionForResult(result);
			onCommit(result.document);
			if (result.focusGroupId) {
				const location = result.focusTabId
					? findTabLocation(result.document, result.focusTabId)
					: findCenterGroup(result.document.center, result.focusGroupId)
						? ({ area: "center", groupId: result.focusGroupId } as const)
						: null;
				if (location) {
					setLocalFocusRequest({
						key: createLayoutId("focus"),
						location,
						...(result.focusTabId ? { tabId: result.focusTabId } : {}),
					});
				}
			}
		},
		[onCommit, updateAttentionForResult],
	);

	const close = useCallback(
		(tab: LayoutTab) => {
			const requestedDocument = documentRef.current;
			const requestedAttention = attentionRef.current;
			const requestedSelectionEpoch = tabSelectionEpoch.current;
			const requestedLocation = findTabLocation(requestedDocument, tab.id);
			const wasSelectedAtRequest = Boolean(
				requestedLocation &&
					readLayoutSelection(requestedAttention, requestedLocation.groupId) === tab.id,
			);
			const requestedTabElement = requestedLocation
				? globalThis.document.getElementById(tabDomId(requestedLocation, tab.id))
				: null;
			const activeElement = globalThis.document.activeElement;
			const closeControlHadFocusAtRequest = Boolean(
				requestedTabElement?.parentElement?.contains(activeElement) ||
					activeElement?.closest('[role="menu"]'),
			);
			onRequestClose(tab, (latestDocument = documentRef.current) => {
				const placed = findPlacedResource(latestDocument, tab);
				const location = placed ? findTabLocation(latestDocument, placed.id) : null;
				const result = closePlacedResource(latestDocument, tab);
				return {
					document: result.document,
					onAccepted: (currentDocument) => {
						const acceptedDocument = currentDocument ?? result.document;
						const latestAttention = attentionRef.current;
						let nextAttention = reconcileAttention(
							acceptedDocument,
							latestAttention,
							latestDocument,
						);
						const survivingGroupIds = new Set(
							collectAllGroups(acceptedDocument).map((group) => group.location.groupId),
						);
						const clockGroups = new Set([
							...Object.keys(requestedAttention.navigationClockByGroup),
							...Object.keys(latestAttention.navigationClockByGroup),
						]);
						const navigationWasOvertaken =
							tabSelectionEpoch.current !== requestedSelectionEpoch ||
							[...clockGroups].some(
								(groupId) =>
									survivingGroupIds.has(groupId) &&
									(readLayoutNavigationClock(requestedAttention, groupId) ?? 0) !==
										(readLayoutNavigationClock(latestAttention, groupId) ?? 0),
							);
						const countsAsNavigation =
							(wasSelectedAtRequest || closeControlHadFocusAtRequest) && !navigationWasOvertaken;
						let focusLocation: LayoutGroupLocation | null = null;
						if (countsAsNavigation && location && location.area !== "center") {
							const sideGroupId = nextAttention.lastFocusedSideGroupId[location.area];
							if (sideGroupId) focusLocation = { area: location.area, groupId: sideGroupId };
						}
						if (countsAsNavigation && !focusLocation) {
							const survivingCenterGroup =
								location?.area === "center"
									? findCenterGroup(acceptedDocument.center, location.groupId)
									: null;
							focusLocation = {
								area: "center",
								groupId: survivingCenterGroup?.id ?? nextAttention.lastFocusedCenterGroupId,
							};
						}
						const focusTabId = focusLocation
							? readLayoutSelection(nextAttention, focusLocation.groupId)
							: undefined;
						if (countsAsNavigation) {
							onUserNavigation();
							if (focusLocation?.area === "center") {
								nextAttention = {
									...nextAttention,
									lastFocusedCenterGroupId: focusLocation.groupId,
									navigationClockByGroup: Object.assign(
										Object.create(null),
										nextAttention.navigationClockByGroup,
										{
											[focusLocation.groupId]:
												(readLayoutNavigationClock(nextAttention, focusLocation.groupId) ?? 0) + 1,
										},
									) as Record<string, number>,
								};
							}
						}
						if (countsAsNavigation && focusLocation) {
							setFocusAfterClose({
								closedTab: tab,
								fallbackDomId: focusTabId
									? tabDomId(focusLocation, focusTabId)
									: groupDomId(focusLocation),
							});
						}
						onAttentionChange(nextAttention);
					},
				};
			});
		},
		[onAttentionChange, onRequestClose, onUserNavigation],
	);

	useEffect(() => {
		const pending = focusAfterClose;
		if (!pending) return;
		if (findPlacedResource(document, pending.closedTab)) {
			setFocusAfterClose((current) => (current === pending ? null : current));
			return;
		}
		const frame = requestAnimationFrame(() => {
			globalThis.document.getElementById(pending.fallbackDomId)?.focus();
			setFocusAfterClose((current) => (current === pending ? null : current));
		});
		return () => cancelAnimationFrame(frame);
	}, [document, focusAfterClose]);

	const handleDragStart = (event: DragStartEvent) => {
		const data = event.active.data.current as DragData | undefined;
		if (!data?.tab) return;
		tabSelectionEpoch.current += 1;
		dragStartEpoch.current = remoteEpoch;
		canceled.current = false;
		setDraggingTab(data.tab);
	};
	const handleDragEnd = (event: DragEndEvent) => {
		const tab = draggingTab;
		setDraggingTab(null);
		if (!tab || canceled.current || dragStartEpoch.current !== remoteEpoch) return;
		const target = event.over?.data.current?.target as DropTarget | undefined;
		if (!target) return;
		let result: LayoutOperationResult;
		switch (target.kind) {
			case "group":
				result = moveTabToGroup(document, tab, target.location);
				break;
			case "insert": {
				const source = findTabLocation(document, tab.id);
				const sourceTabs = source ? findLayoutGroupTabs(document, source) : null;
				const sourceIndex = sourceTabs?.findIndex((candidate) => candidate.id === tab.id) ?? -1;
				const insertionIndex =
					source?.area === target.location.area &&
					source.groupId === target.location.groupId &&
					sourceIndex >= 0 &&
					sourceIndex < target.index
						? target.index - 1
						: target.index;
				result = moveTabToGroup(document, tab, target.location, insertionIndex);
				break;
			}
			case "split":
				result =
					tab.kind === "tool"
						? { reason: "Tools stay in a side region." }
						: splitCenterGroup(document, target.groupId, target.direction, tab);
				break;
			case "side-edge":
				result =
					tab.kind === "terminal" || tab.kind === "tool"
						? createSideGroup(document, target.side, tab, target.index, maxSideGroups)
						: { reason: "That tab type cannot move to a side region." };
				break;
		}
		if (!isLayoutUnavailable(result)) apply(result);
	};

	const leftVisible = document.left.visible && document.left.groups.length > 0;
	const rightVisible = document.right.visible && document.right.groups.length > 0;
	const visibleSideMinimums = (leftVisible ? 8 : 0) + (rightVisible ? 8 : 0);
	const centerMinimumPercent = Math.min(
		Math.max(10, 100 - visibleSideMinimums),
		workbenchWidth > 0 ? (LAYOUT_LIMITS.minCenterWidth / workbenchWidth) * 100 : 10,
	);
	const outerCurrent = useMemo(
		() => [
			...(leftVisible ? [document.left.width * 100] : []),
			100 -
				(leftVisible ? document.left.width * 100 : 0) -
				(rightVisible ? document.right.width * 100 : 0),
			...(rightVisible ? [document.right.width * 100] : []),
		],
		[document.left.width, document.right.width, leftVisible, rightVisible],
	);
	const outerGroupRef = useRef<ImperativePanelGroupHandle>(null);
	useEffect(() => {
		const group = outerGroupRef.current;
		if (group && !sameSizes(group.getLayout(), outerCurrent)) group.setLayout(outerCurrent);
	}, [outerCurrent]);
	const outerResize = useCommittedSizes(
		outerCurrent,
		remoteEpoch,
		(sizes) => {
			let index = 0;
			let next = document;
			const collapsedSides: LayoutSide[] = [];
			if (leftVisible) {
				const size = sizes[index] ?? outerCurrent[index] ?? 18;
				if (size <= Number.EPSILON) collapsedSides.push("left");
				else next = resizeSideRegion(next, "left", size / 100);
				index += 1;
			}
			index += 1;
			if (rightVisible) {
				const size = sizes[index] ?? outerCurrent[index] ?? 28;
				if (size <= Number.EPSILON) collapsedSides.push("right");
				else next = resizeSideRegion(next, "right", size / 100);
			}
			if (collapsedSides.length === 0) {
				if (next !== document) onCommit(next);
				return;
			}
			let result: LayoutMutationResult = { document: next };
			for (const side of collapsedSides) {
				result = hideSide(result.document, side, attentionRef.current);
			}
			apply(result);
		},
		onRemoteGestureCanceled,
	);
	const focusableGroups = useMemo(() => visibleFocusableGroups(document), [document]);
	const focusAdjacentGroup = useCallback(
		(delta: -1 | 1, fromGroupId?: string) => {
			const groups = focusableGroups;
			if (groups.length < 2) return;
			const activeGroupId =
				fromGroupId ??
				globalThis.document.activeElement?.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
			const currentAttention = attentionRef.current;
			let index = groups.findIndex((group) => group.location.groupId === activeGroupId);
			if (index < 0) {
				index = groups.findIndex(
					(group) => group.location.groupId === currentAttention.lastFocusedCenterGroupId,
				);
			}
			const baseIndex = index < 0 ? (delta === 1 ? -1 : 0) : index;
			const target = groups[(baseIndex + delta + groups.length) % groups.length];
			if (!target) return;
			const selected =
				target.tabs.find(
					(tab) => tab.id === readLayoutSelection(currentAttention, target.location.groupId),
				) ?? target.tabs[0];
			onUserNavigation();
			if (selected) {
				onAttentionChange(selectTab(currentAttention, target.location, selected.id));
				setLocalFocusRequest({
					key: createLayoutId("focus-group"),
					location: target.location,
					tabId: selected.id,
				});
				return;
			}
			if (target.location.area !== "center") return;
			const nextAttention = {
				...currentAttention,
				lastFocusedCenterGroupId: target.location.groupId,
				navigationClockByGroup: Object.assign(
					Object.create(null),
					currentAttention.navigationClockByGroup,
					{
						[target.location.groupId]:
							(readLayoutNavigationClock(currentAttention, target.location.groupId) ?? 0) + 1,
					},
				) as Record<string, number>,
			};
			onAttentionChange(nextAttention);
			setLocalFocusRequest({
				key: createLayoutId("focus-group"),
				location: target.location,
			});
		},
		[focusableGroups, onAttentionChange, onUserNavigation],
	);
	const canFocusAdjacentGroup = focusableGroups.length > 1;
	const hideSideRegion = useCallback(
		(side: LayoutSide) => apply(hideSide(document, side, attentionRef.current)),
		[apply, document],
	);
	const revealMissingTool = useCallback(
		(tool: LayoutToolId) => {
			const result = revealTool(document, tool, maxSideGroups);
			if (!isLayoutUnavailable(result)) apply(result);
		},
		[apply, document, maxSideGroups],
	);
	const shared: SharedGroupProps = {
		document,
		attention,
		selectionEpoch: tabSelectionEpoch,
		maxSideGroups,
		draggingTab,
		renderTabBody,
		renderTabAdornment,
		onAttentionChange,
		onUserNavigation,
		onRemoteGestureCanceled,
		onApply: apply,
		onClose: close,
		onFocusAdjacentGroup: focusAdjacentGroup,
		onHideSide: hideSideRegion,
		onRevealTool: revealMissingTool,
		canFocusAdjacentGroup,
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={pointerWithin}
			measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
			onDragStart={handleDragStart}
			onDragCancel={() => setDraggingTab(null)}
			onDragEnd={handleDragEnd}
		>
			<div
				ref={workbenchRef}
				data-testid="workbench"
				className="flex h-full min-h-0 min-w-0 overflow-hidden"
				onPointerDownCapture={() => {
					tabSelectionEpoch.current += 1;
				}}
				onKeyDownCapture={(event) => {
					if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== "F6") return;
					event.preventDefault();
					event.stopPropagation();
					focusAdjacentGroup(event.shiftKey ? -1 : 1);
				}}
			>
				{!leftVisible ? (
					<HiddenSideRail
						side="left"
						onShow={() => {
							const result = showSide(document, "left", maxSideGroups, attention);
							if (!isLayoutUnavailable(result)) apply(result);
						}}
						showEnabled={canShowSide(document, "left")}
						dropEnabled={
							!!draggingTab &&
							canPlaceLayoutTab(draggingTab, "left") &&
							canCreateSideGroup(
								document,
								"left",
								draggingTab,
								maxSideGroups,
								document.left.groups.length,
							)
						}
						targetIndex={document.left.groups.length}
					/>
				) : null}
				<ResizablePanelGroup
					ref={outerGroupRef}
					key={tupleKey(
						"outer-workbench",
						String(leftVisible),
						String(rightVisible),
						String(remoteEpoch),
					)}
					direction="horizontal"
					onLayout={outerResize.onLayout}
					className="min-h-0 min-w-0 flex-1"
				>
					{leftVisible ? (
						<>
							<ResizablePanel
								id="layout-left"
								order={1}
								defaultSize={outerCurrent[0]}
								minSize={8}
								collapsedSize={0}
								collapsible
							>
								<SideStack
									side="left"
									region={document.left}
									remoteEpoch={remoteEpoch}
									renderToolBody={renderToolBody}
									onCommit={onCommit}
									{...shared}
								/>
							</ResizablePanel>
							<ResizableHandle
								direction="horizontal"
								data-testid="resize-left"
								onDragging={outerResize.onDragging}
								onKeyDownCapture={outerResize.onKeyboard}
								onKeyUpCapture={outerResize.onKeyboardEnd}
							/>
						</>
					) : null}
					<ResizablePanel
						id="layout-center"
						order={2}
						defaultSize={outerCurrent[leftVisible ? 1 : 0]}
						minSize={centerMinimumPercent}
					>
						<main data-testid="center-tabs" className="h-full min-h-0 min-w-0">
							<CenterNodeView
								node={document.center}
								remoteEpoch={remoteEpoch}
								onCommit={onCommit}
								onNewChat={onNewChat}
								renderEmptyCenter={renderEmptyCenter}
								renderCenterActions={renderCenterActions}
								{...shared}
							/>
						</main>
					</ResizablePanel>
					{rightVisible ? (
						<>
							<ResizableHandle
								direction="horizontal"
								data-testid="resize-right"
								onDragging={outerResize.onDragging}
								onKeyDownCapture={outerResize.onKeyboard}
								onKeyUpCapture={outerResize.onKeyboardEnd}
							/>
							<ResizablePanel
								id="layout-right"
								order={3}
								defaultSize={outerCurrent[outerCurrent.length - 1]}
								minSize={8}
								collapsedSize={0}
								collapsible
							>
								<SideStack
									side="right"
									region={document.right}
									remoteEpoch={remoteEpoch}
									renderToolBody={renderToolBody}
									onCommit={onCommit}
									{...shared}
								/>
							</ResizablePanel>
						</>
					) : null}
				</ResizablePanelGroup>
				{!rightVisible ? (
					<HiddenSideRail
						side="right"
						onShow={() => {
							const result = showSide(document, "right", maxSideGroups, attention);
							if (!isLayoutUnavailable(result)) apply(result);
						}}
						showEnabled={canShowSide(document, "right")}
						dropEnabled={
							!!draggingTab &&
							canPlaceLayoutTab(draggingTab, "right") &&
							canCreateSideGroup(
								document,
								"right",
								draggingTab,
								maxSideGroups,
								document.right.groups.length,
							)
						}
						targetIndex={document.right.groups.length}
					/>
				) : null}
			</div>
			<DragOverlay dropAnimation={null}>
				{draggingTab ? (
					<div className="flex max-w-56 items-center gap-xs rounded-[var(--radius-sm)] border border-primary bg-container-elevated-bg px-sm py-xs tr-text-ui text-text-default shadow-lg">
						{tabIcon(draggingTab)}
						<span className="truncate">{draggingTab.name}</span>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
