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
import {
	RiCheckFill as Check,
	RiArrowLeftSLine as ChevronLeft,
	RiFileLine as File,
	RiGitPullRequestLine as GitCompareArrows,
	RiListCheck3 as ListTodo,
	RiChatNewLine as MessageSquarePlus,
	RiMoreLine as MoreHorizontal,
	RiLayoutBottomLine as PanelBottomOpen,
	RiLayoutLeftLine as PanelLeftOpen,
	RiLayoutRightLine as PanelRightOpen,
	RiLayout2Line as PanelsTopLeft,
	RiAddLine as Plus,
	RiBookOpenFill,
	RiBookOpenLine,
	RiChat2Fill,
	RiChat2Line,
	RiCollapseVerticalLine,
	RiDiscussFill,
	RiDiscussLine,
	RiExpandVerticalLine,
	RiFileFill,
	RiFolder2Fill,
	RiFolder2Line,
	RiGitPullRequestFill,
	RiLayout2Fill,
	RiTerminalBoxFill,
	RiSearchLine as Search,
	RiTerminalBoxLine as SquareTerminal,
	RiCloseLine as X,
} from "@remixicon/react";
import type {
	LayoutAuxiliaryRegion,
	LayoutBottomAlignment,
	LayoutBottomGroup,
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
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CustomIcon } from "../../components/CustomIcon";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import {
	type ImperativePanelGroupHandle,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "../../components/ui/resizable";
import { IconTooltip } from "../../components/ui/tooltip";
import {
	DOUBLE_CLICK_SETTLE_MS,
	type LayoutAttention,
	readLayoutNavigationClock,
	readLayoutSelection,
	tupleKey,
} from "../../lib";
import {
	type CenterSplitDirection,
	canCreateAuxiliaryGroup,
	canCreateSideGroup,
	canPlaceLayoutTab,
	canShowSide,
	closePlacedResource,
	collectAllGroups,
	collectCenterGroups,
	createAuxiliaryGroup,
	createLayoutId,
	findAuxiliaryGroup,
	findCenterGroup,
	findPlacedResource,
	findTabLocation,
	hideBottom,
	hideSide,
	isLayoutUnavailable,
	keepPreview,
	LAYOUT_LIMITS,
	type LayoutGroupLocation,
	type LayoutMutationResult,
	type LayoutOperationResult,
	type LayoutSide,
	layoutTabName,
	moveTabToGroup,
	reconcileAttention,
	removeLayoutGroup,
	resizeAuxiliaryGroups,
	resizeBottomRegion,
	resizeCenterSplit,
	resizeSideGroups,
	resizeSideRegion,
	revealTool,
	selectTab,
	setAuxiliaryGroupFolded,
	setBottomAlignment,
	setSideGroupFolded,
	showBottom,
	showSide,
	splitCenterGroup,
	toolTab,
	unplacedTools,
	unplacedToolsForSide,
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
	maxBottomGroups: number;
	projectionEpoch: number;
	focusRequest?: LayoutTabFocusRequest;
	renderTabBody: (tab: LayoutCenterTab | Extract<LayoutSideTab, { kind: "terminal" }>) => ReactNode;
	renderTabAdornment: (tab: LayoutTab) => ReactNode;
	renderToolBody: (tool: LayoutToolId) => ReactNode;
	renderEmptyCenter: (groupId: string) => ReactNode;
	renderCenterActions: (groupId: string) => ReactNode;
	renderSideMenuActions: (side: LayoutSide, groupId: string) => ReactNode;
	onCommit: (document: WorkspaceLayoutDocument) => void;
	onAttentionChange: (attention: LayoutAttention) => void;
	onUserNavigation: () => void;
	readNavigationTick: () => number;
	onRequestClose: (
		tab: LayoutTab,
		prepare: (latestDocument?: WorkspaceLayoutDocument) => PreparedLayoutClose,
	) => void;
	onNewChat: (groupId: string) => void;
	onNewTerminal: (groupId: string, area: "center" | LayoutAuxiliaryRegion) => void;
	onGestureCanceled?: () => void;
}

type DropTarget =
	| { kind: "group"; location: LayoutGroupLocation }
	| { kind: "insert"; location: LayoutGroupLocation; index: number }
	| { kind: "split"; groupId: string; direction: CenterSplitDirection }
	| { kind: "auxiliary-edge"; region: LayoutAuxiliaryRegion; index: number };

interface DragData {
	tab: LayoutTab;
}

function sameSizes(first: readonly number[], second: readonly number[], tolerance = 0.15): boolean {
	return (
		first.length === second.length &&
		first.every((value, index) => Math.abs(value - (second[index] ?? 0)) < tolerance)
	);
}

function isResizeArrowKey(key: string): boolean {
	return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key);
}

function useCommittedSizes(
	current: readonly number[],
	projectionEpoch: number,
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
	const startEpoch = useRef(projectionEpoch);
	const observedEpoch = useRef(projectionEpoch);
	const epoch = useRef(projectionEpoch);
	const currentRef = useRef(current);
	const commitRef = useRef(commit);
	epoch.current = projectionEpoch;
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
		if (observedEpoch.current === projectionEpoch) return;
		if (dragging.current || keyboard.current) {
			cancelStaleGesture();
			return;
		}
		observedEpoch.current = projectionEpoch;
	}, [cancelStaleGesture, projectionEpoch]);

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
		if (!isResizeArrowKey(event.key)) return;
		startEpoch.current = epoch.current;
		keyboard.current = true;
	}, []);
	const onKeyboardEnd = useCallback(() => {
		keyboard.current = false;
		pending.current = null;
	}, []);
	return { onLayout, onDragging, onKeyboard, onKeyboardEnd };
}

function bindSideResize(
	side: LayoutSide,
	resize: ReturnType<typeof useCommittedSizes>,
	activeSide: { current: LayoutSide | null },
) {
	return {
		onDragging: (active: boolean) => {
			if (active) activeSide.current = side;
			resize.onDragging(active);
			if (!active && activeSide.current === side) activeSide.current = null;
		},
		onKeyboard: (event: { key: string }) => {
			if (isResizeArrowKey(event.key)) activeSide.current = side;
			resize.onKeyboard(event);
		},
		onKeyboardEnd: () => {
			resize.onKeyboardEnd();
			if (activeSide.current === side) activeSide.current = null;
		},
	};
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

interface HorizontalOverflow {
	before: boolean;
	after: boolean;
}

function useHorizontalOverflow(ref: React.RefObject<HTMLDivElement | null>): HorizontalOverflow {
	const [overflow, setOverflow] = useState<HorizontalOverflow>({ before: false, after: false });
	const update = useCallback(() => {
		const element = ref.current;
		if (!element) return;
		const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
		const next = {
			before: element.scrollLeft > 1,
			after: element.scrollLeft < maximum - 1,
		};
		setOverflow((current) =>
			current.before === next.before && current.after === next.after ? current : next,
		);
	}, [ref]);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const frame = requestAnimationFrame(update);
		element.addEventListener("scroll", update, { passive: true });
		const resize = new ResizeObserver(update);
		resize.observe(element);
		const mutations = new MutationObserver(update);
		mutations.observe(element, {
			attributes: true,
			characterData: true,
			childList: true,
			subtree: true,
		});
		return () => {
			cancelAnimationFrame(frame);
			element.removeEventListener("scroll", update);
			resize.disconnect();
			mutations.disconnect();
		};
	}, [ref, update]);

	return overflow;
}

function tabSearchKeywords(tab: LayoutTab): string[] {
	const name = layoutTabName(tab);
	switch (tab.kind) {
		case "file":
		case "diff":
			return [name, tab.kind, tab.path];
		case "chat":
			return [name, tab.kind, tab.sessionId];
		case "document":
			return [name, tab.kind, tab.sourceId, tab.docPath];
		case "terminal":
			return [name, tab.kind, tab.tabKey];
		case "tool":
			return [name, tab.kind, tab.tool];
	}
}

function tabIcon(tab: LayoutTab, active = false): ReactNode {
	const cls = "size-14 shrink-0";
	switch (tab.kind) {
		case "file":
			return active ? <RiFileFill className={cls} /> : <File className={cls} />;
		case "diff":
			return active ? (
				<RiGitPullRequestFill className={cls} />
			) : (
				<GitCompareArrows className={cls} />
			);
		case "chat":
			return active ? <RiChat2Fill className={cls} /> : <RiChat2Line className={cls} />;
		case "document":
			return <ListTodo className={cls} />;
		case "terminal":
			return active ? <RiTerminalBoxFill className={cls} /> : <SquareTerminal className={cls} />;
		case "tool":
			switch (tab.tool) {
				case "projects":
					return active ? <RiFolder2Fill className={cls} /> : <RiFolder2Line className={cls} />;
				case "specs":
					return active ? <RiBookOpenFill className={cls} /> : <RiBookOpenLine className={cls} />;
				case "files":
					return active ? <RiFileFill className={cls} /> : <File className={cls} />;
				case "changes":
					return <CustomIcon name={active ? "file-diff-fill" : "file-diff-line"} className={cls} />;
				case "review":
					return active ? <RiDiscussFill className={cls} /> : <RiDiscussLine className={cls} />;
				default:
					return active ? <RiLayout2Fill className={cls} /> : <PanelsTopLeft className={cls} />;
			}
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

function focusLayoutRequest(request: LayoutTabFocusRequest): void {
	const tab = request.tabId
		? globalThis.document.getElementById(tabDomId(request.location, request.tabId))
		: null;
	(tab ?? globalThis.document.getElementById(groupDomId(request.location)))?.focus();
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
	tabControlsRendered: boolean;
}> {
	return [
		...(document.left.visible
			? document.left.groups.map((group) => ({
					location: { area: "left" as const, groupId: group.id },
					tabs: group.tabs,
					tabControlsRendered: true,
				}))
			: []),
		...collectCenterGroups(document.center).map((group) => ({
			location: { area: "center" as const, groupId: group.id },
			tabs: group.tabs,
			tabControlsRendered: true,
		})),
		...(document.right.visible
			? document.right.groups.map((group) => ({
					location: { area: "right" as const, groupId: group.id },
					tabs: group.tabs,
					tabControlsRendered: true,
				}))
			: []),
		...(document.bottom.visible
			? document.bottom.groups.map((group) => ({
					location: { area: "bottom" as const, groupId: group.id },
					tabs: group.tabs,
					tabControlsRendered: !group.folded,
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
	maxBottomGroups: number;
	draggingTab: LayoutTab | null;
	onSelect: (tabId: string, keep?: boolean) => void;
	onClose: (tab: LayoutTab) => void;
	onApply: (result: LayoutMutationResult) => void;
	onFocusAdjacentGroup: (delta: -1 | 1, fromGroupId?: string) => void;
	onHideSide: (region: LayoutAuxiliaryRegion) => void;
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
	maxBottomGroups,
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
	const scrollOverflow = useHorizontalOverflow(scroller);
	const tabRefs = useRef(new Map<string, HTMLButtonElement>());
	const overflowFocusTarget = useRef<string | null>(null);
	const [overflowOpen, setOverflowOpen] = useState(false);
	const overflowing = scrollOverflow.before || scrollOverflow.after;
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

	useEffect(() => {
		if (!overflowing) setOverflowOpen(false);
	}, [overflowing]);

	const selectAt = (index: number) => {
		const tab = tabs[index];
		if (!tab) return;
		selectTab(tab.id);
		requestAnimationFrame(() => tabRefs.current.get(tab.id)?.focus());
	};

	const compatibilityTestId =
		location.area === "center"
			? "center-tab-strip"
			: location.area === "bottom"
				? "bottom-tab-strip"
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
							location={location}
							attention={attention}
							selectionEpoch={selectionEpoch}
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
	maxBottomGroups: number;
	register: (node: HTMLButtonElement | null) => void;
	onSelect: (tabId: string, keep?: boolean) => void;
	onClose: () => void;
	onApply: (result: LayoutMutationResult) => void;
	onFocusAdjacentGroup: (delta: -1 | 1, fromGroupId?: string) => void;
	onHideSide: (region: LayoutAuxiliaryRegion) => void;
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
	maxBottomGroups,
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
					data-session-id={tab.kind === "chat" ? tab.sessionId : undefined}
					data-dragging={drag.isDragging || undefined}
					className="group relative flex min-w-96 max-w-192 shrink-0 items-center border-border-default border-r text-text-muted after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-[2px] after:rounded-full after:content-[''] data-[active=true]:bg-control-bg-selected data-[active=true]:text-text-default data-[active=true]:after:bg-primary data-[dragging]:opacity-40"
				>
					<div
						ref={before.setNodeRef}
						aria-hidden="true"
						data-drop-label={acceptsBefore ? `Insert before ${name}` : undefined}
						data-drop-active={before.isOver || undefined}
						className="pointer-events-none absolute inset-y-0 left-0 z-10 w-1/2 border-primary data-[drop-active]:border-l-2"
					/>
					<div
						ref={after.setNodeRef}
						aria-hidden="true"
						data-drop-label={acceptsAfter ? `Insert after ${name}` : undefined}
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
						title={preview ? "Preview — double-click to keep" : name}
						onClick={selectFromClick}
						onDoubleClick={selectFromDoubleClick}
						onKeyDown={onKeyDown}
						className={`flex min-w-0 flex-1 items-center gap-4 py-4 pl-8 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${tab.kind === "tool" ? "pr-8" : ""}`}
					>
						{tabIcon(tab, active)}
						<span className={`truncate ${preview ? "italic" : ""}`}>{name}</span>
						{renderTabAdornment(tab)}
					</button>
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
	maxBottomGroups: number;
	draggingTab: LayoutTab | null;
	renderTabBody: WorkbenchProps["renderTabBody"];
	renderTabAdornment: WorkbenchProps["renderTabAdornment"];
	renderToolBody: WorkbenchProps["renderToolBody"];
	renderSideMenuActions: WorkbenchProps["renderSideMenuActions"];
	onAttentionChange: WorkbenchProps["onAttentionChange"];
	onUserNavigation: WorkbenchProps["onUserNavigation"];
	onGestureCanceled: (() => void) | undefined;
	onApply: (result: LayoutMutationResult) => void;
	onClose: (tab: LayoutTab) => void;
	onFocusAdjacentGroup: (delta: -1 | 1, fromGroupId?: string) => void;
	onHideSide: (region: LayoutAuxiliaryRegion) => void;
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
	const groupRemoval = removeLayoutGroup(shared.document, location);
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
				maxBottomGroups={shared.maxBottomGroups}
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
									className="flex w-32 shrink-0 items-center justify-center text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text"
								>
									<X className="size-14" />
								</button>
							</IconTooltip>
						) : null}
						<IconTooltip label="New chat">
							<button
								type="button"
								data-testid="new-chat"
								aria-label="New chat"
								onClick={() => onNewChat(group.id)}
								className="flex w-32 shrink-0 items-center justify-center text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
							>
								<MessageSquarePlus className="size-14" />
							</button>
						</IconTooltip>
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
								className="absolute inset-y-1/4 left-4 w-1/5"
							/>
							<DropZone
								id={tupleKey("dnd-split", group.id, "right")}
								target={{ kind: "split", groupId: group.id, direction: "right" }}
								label="Split right"
								className="absolute inset-y-1/4 right-4 w-1/5"
							/>
						</>
					) : null}
					{splitGeometry.vertical ? (
						<>
							<DropZone
								id={tupleKey("dnd-split", group.id, "up")}
								target={{ kind: "split", groupId: group.id, direction: "up" }}
								label="Split up"
								className="absolute inset-x-1/4 top-32 h-1/5"
							/>
							<DropZone
								id={tupleKey("dnd-split", group.id, "down")}
								target={{ kind: "split", groupId: group.id, direction: "down" }}
								label="Split down"
								className="absolute inset-x-1/4 bottom-4 h-1/5"
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
	projectionEpoch: number;
	onCommit: WorkbenchProps["onCommit"];
	onNewChat: WorkbenchProps["onNewChat"];
	renderEmptyCenter: WorkbenchProps["renderEmptyCenter"];
	renderCenterActions: WorkbenchProps["renderCenterActions"];
};

function CenterNodeView({
	node,
	projectionEpoch,
	onCommit,
	onNewChat,
	...shared
}: CenterNodeProps) {
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
			projectionEpoch={projectionEpoch}
			onCommit={onCommit}
			onNewChat={onNewChat}
			{...shared}
		/>
	);
}

function CenterSplitView({
	node,
	projectionEpoch,
	onCommit,
	onNewChat,
	...shared
}: Omit<CenterNodeProps, "node"> & { node: LayoutCenterSplit }) {
	const size = useElementSize();
	const weights = node.weights.map((weight) => weight * 100);
	const resize = useCommittedSizes(
		weights,
		projectionEpoch,
		(sizes) => {
			const next = resizeCenterSplit(shared.document, node.id, [sizes[0] ?? 50, sizes[1] ?? 50]);
			if (next !== shared.document) onCommit(next);
		},
		shared.onGestureCanceled,
	);
	const dimension = node.direction === "horizontal" ? size.width : size.height;
	const minimumPixels =
		node.direction === "horizontal" ? LAYOUT_LIMITS.minCenterWidth : LAYOUT_LIMITS.minCenterHeight;
	const minimumPercent = dimension >= minimumPixels * 2 ? (minimumPixels / dimension) * 100 : 4;
	return (
		<div ref={size.ref} className="h-full min-h-0 min-w-0 overflow-hidden">
			<ResizablePanelGroup
				key={tupleKey("center-split", node.id, String(projectionEpoch))}
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
						projectionEpoch={projectionEpoch}
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
						projectionEpoch={projectionEpoch}
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
	foldable,
	renderToolBody,
	onFold,
	...shared
}: SharedGroupProps & {
	side: LayoutSide;
	group: LayoutSideGroup;
	groupIndex: number;
	foldable: boolean;
	renderToolBody: WorkbenchProps["renderToolBody"];
	onFold: () => void;
}) {
	const location: LayoutGroupLocation = { area: side, groupId: group.id };
	const groupRemoval = removeLayoutGroup(shared.document, location);
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
						maxBottomGroups={shared.maxBottomGroups}
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
					<Fragment key={selected.id}>
						{selected.kind === "tool"
							? renderToolBody(selected.tool)
							: selected.kind === "terminal"
								? shared.renderTabBody(selected)
								: null}
					</Fragment>
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
}

function SideGroupMenu({
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

function SideStack({
	side,
	region,
	projectionEpoch,
	renderToolBody,
	onCommit,
	...shared
}: SharedGroupProps & {
	side: LayoutSide;
	region: WorkspaceLayoutDocument[LayoutSide];
	projectionEpoch: number;
	renderToolBody: WorkbenchProps["renderToolBody"];
	onCommit: WorkbenchProps["onCommit"];
}) {
	const size = useElementSize();
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
			ref={size.ref}
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

const BOTTOM_ALIGNMENT_LABELS: Record<LayoutBottomAlignment, string> = {
	center: "Below center",
	"center-left": "Below center and left",
	"center-right": "Below center and right",
	full: "Full width",
};

function BottomAlignmentMenu({
	alignment,
	onChange,
	onHide,
}: {
	alignment: LayoutBottomAlignment;
	onChange: (alignment: LayoutBottomAlignment) => void;
	onHide: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Bottom panel alignment"
				title={`Bottom panel alignment: ${BOTTOM_ALIGNMENT_LABELS[alignment]}`}
				className="flex w-32 shrink-0 items-center justify-center border-border-muted border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				<MoreHorizontal className="size-16" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-224">
				<DropdownMenuRadioGroup
					value={alignment}
					onValueChange={(value) => onChange(value as LayoutBottomAlignment)}
				>
					{(Object.keys(BOTTOM_ALIGNMENT_LABELS) as LayoutBottomAlignment[]).map((value) => (
						<DropdownMenuRadioItem
							key={value}
							value={value}
							data-testid={`bottom-align-${value}`}
							className="justify-between"
						>
							<span>{BOTTOM_ALIGNMENT_LABELS[value]}</span>
							{alignment === value ? <Check className="text-primary" /> : null}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={onHide}>Hide bottom panel</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function BottomCreationTargets({
	group,
	groupIndex,
	shared,
}: {
	group: LayoutBottomGroup;
	groupIndex: number;
	shared: SharedGroupProps;
}) {
	const tab =
		shared.draggingTab?.kind === "tool" || shared.draggingTab?.kind === "terminal"
			? shared.draggingTab
			: null;
	const canCreateLeft = Boolean(
		tab &&
			canCreateAuxiliaryGroup(shared.document, "bottom", tab, shared.maxBottomGroups, groupIndex),
	);
	const canCreateRight = Boolean(
		tab &&
			canCreateAuxiliaryGroup(
				shared.document,
				"bottom",
				tab,
				shared.maxBottomGroups,
				groupIndex + 1,
			),
	);
	if (!canCreateLeft && !canCreateRight) return null;
	return (
		<div className="pointer-events-none absolute inset-0 z-30">
			{canCreateLeft ? (
				<DropZone
					id={tupleKey("dnd-bottom-group", group.id, "left")}
					target={{ kind: "auxiliary-edge", region: "bottom", index: groupIndex }}
					label="Create bottom group to the left"
					className="absolute inset-y-4 left-4 right-1/2"
				/>
			) : null}
			{canCreateRight ? (
				<DropZone
					id={tupleKey("dnd-bottom-group", group.id, "right")}
					target={{ kind: "auxiliary-edge", region: "bottom", index: groupIndex + 1 }}
					label="Create bottom group to the right"
					className="absolute inset-y-4 left-1/2 right-4"
				/>
			) : null}
		</div>
	);
}

function BottomGroupView({
	group,
	groupIndex,
	showAlignmentMenu,
	onFold,
	onNewTerminal,
	onAlignmentChange,
	...shared
}: SharedGroupProps & {
	group: LayoutBottomGroup;
	groupIndex: number;
	showAlignmentMenu: boolean;
	onFold: () => void;
	onNewTerminal: () => void;
	onAlignmentChange: (alignment: LayoutBottomAlignment) => void;
}) {
	const location: LayoutGroupLocation = { area: "bottom", groupId: group.id };
	const groupRemoval = removeLayoutGroup(shared.document, location);
	const selectedId = readLayoutSelection(shared.attention, group.id);
	const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
	const selectedName = selected ? layoutTabName(selected) : undefined;
	return (
		<section
			id={groupDomId(location)}
			data-testid="bottom-group"
			data-group-id={group.id}
			data-folded="false"
			tabIndex={-1}
			aria-label={selectedName ? `Bottom group: ${selectedName}` : "Empty bottom group"}
			className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-container-sidebar-bg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
			onFocusCapture={() => {
				if (selected) {
					shared.onAttentionChange(selectTab(shared.attention, location, selected.id, false));
					return;
				}
				shared.onAttentionChange({
					...shared.attention,
					lastFocusedSideGroupId: Object.assign(
						Object.create(null),
						shared.attention.lastFocusedSideGroupId,
						{ bottom: group.id },
					),
				});
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
						maxBottomGroups={shared.maxBottomGroups}
						draggingTab={shared.draggingTab}
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
						trailing={
							showAlignmentMenu ? (
								<BottomAlignmentMenu
									alignment={shared.document.bottom.alignment}
									onChange={onAlignmentChange}
									onHide={() => shared.onHideSide("bottom")}
								/>
							) : null
						}
					/>
				</div>
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
				<button
					type="button"
					data-testid="bottom-group-fold"
					aria-label="Fold bottom group"
					aria-expanded="true"
					onClick={onFold}
					className="flex w-32 shrink-0 items-center justify-center border-border-muted border-b border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<ChevronLeft className="size-16" />
				</button>
			</div>
			<div
				id={groupPanelId(location)}
				role="tabpanel"
				aria-labelledby={selected ? tabDomId(location, selected.id) : undefined}
				className="relative min-h-0 flex-1 overflow-auto"
			>
				{selected ? (
					<Fragment key={selected.id}>
						{selected.kind === "tool"
							? shared.renderToolBody(selected.tool)
							: selected.kind === "terminal"
								? shared.renderTabBody(selected)
								: null}
					</Fragment>
				) : (
					<div className="flex h-full items-center justify-center p-12">
						<button
							type="button"
							data-testid="bottom-new-terminal"
							onClick={onNewTerminal}
							className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
						>
							<SquareTerminal className="size-16" /> New terminal
						</button>
					</div>
				)}
				<BottomCreationTargets group={group} groupIndex={groupIndex} shared={shared} />
			</div>
		</section>
	);
}

function BottomFoldedGroup({
	group,
	groupIndex,
	showAlignmentMenu,
	onExpand,
	onAlignmentChange,
	shared,
}: {
	group: LayoutBottomGroup;
	groupIndex: number;
	showAlignmentMenu: boolean;
	onExpand: () => void;
	onAlignmentChange: (alignment: LayoutBottomAlignment) => void;
	shared: SharedGroupProps;
}) {
	const selectedId = readLayoutSelection(shared.attention, group.id);
	const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
	const selectedName = selected ? layoutTabName(selected) : undefined;
	const location: LayoutGroupLocation = { area: "bottom", groupId: group.id };
	const restoreId = groupDomId(location);
	const panelId = groupPanelId(location);
	const drop = useDroppable({
		id: tupleKey("dnd-bottom-folded", group.id),
		data: { target: { kind: "group", location } satisfies DropTarget },
		disabled: !shared.draggingTab || !canPlaceLayoutTab(shared.draggingTab, "bottom"),
	});
	return (
		<section
			ref={drop.setNodeRef}
			data-testid="bottom-group"
			data-group-id={group.id}
			data-folded="true"
			data-drop-active={drop.isOver || undefined}
			aria-label={
				selectedName ? `Folded bottom group: ${selectedName}` : "Folded empty bottom group"
			}
			className="relative flex h-full items-stretch overflow-hidden border-border-default border-r bg-container-sidebar-bg data-[drop-active]:bg-primary-subtle"
		>
			<div className="flex min-h-0 w-full flex-col">
				{showAlignmentMenu ? (
					<BottomAlignmentMenu
						alignment={shared.document.bottom.alignment}
						onChange={onAlignmentChange}
						onHide={() => shared.onHideSide("bottom")}
					/>
				) : null}
				<button
					id={restoreId}
					type="button"
					data-testid="bottom-group-restore"
					aria-label={`Expand bottom group${selectedName ? ` ${selectedName}` : ""}`}
					aria-controls={panelId}
					aria-expanded="false"
					onClick={onExpand}
					className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<span className="truncate [writing-mode:vertical-rl]">
						{selectedName ?? "Empty group"}
					</span>
				</button>
				<div id={panelId} role="tabpanel" aria-labelledby={restoreId} hidden />
			</div>
			<BottomCreationTargets group={group} groupIndex={groupIndex} shared={shared} />
		</section>
	);
}

function BottomStack({
	projectionEpoch,
	onCommit,
	onNewTerminal,
	...shared
}: SharedGroupProps & {
	projectionEpoch: number;
	onCommit: WorkbenchProps["onCommit"];
	onNewTerminal: WorkbenchProps["onNewTerminal"];
}) {
	const size = useElementSize();
	const region = shared.document.bottom;
	const alignmentMenuGroupId =
		region.groups.find((group) => !group.folded)?.id ?? region.groups[0]?.id;
	const commitAlignment = (alignment: LayoutBottomAlignment) => {
		const next = setBottomAlignment(shared.document, alignment);
		if (next !== shared.document) onCommit(next);
	};
	const total = region.groups.reduce((sum, group) => sum + group.weight, 0) || 1;
	const current = region.groups.map((group) => (group.weight / total) * 100);
	const resize = useCommittedSizes(
		current,
		projectionEpoch,
		(sizes) => {
			const next = resizeAuxiliaryGroups(shared.document, "bottom", sizes);
			if (next !== shared.document) onCommit(next);
		},
		shared.onGestureCanceled,
	);
	const foldedCount = region.groups.filter((group) => group.folded).length;
	const expandedCount = region.groups.length - foldedCount;
	const roomForMinimums =
		size.width >=
		foldedCount * LAYOUT_LIMITS.foldedBottomWidth +
			expandedCount * LAYOUT_LIMITS.minBottomGroupWidth;
	const equalShare = 100 / Math.max(1, region.groups.length);
	const requestedFoldedPercent =
		size.width > 0 ? (LAYOUT_LIMITS.foldedBottomWidth / size.width) * 100 : 4;
	const foldedPercent = roomForMinimums
		? requestedFoldedPercent
		: Math.min(requestedFoldedPercent, equalShare);
	const expandedMinimum =
		roomForMinimums && size.width > 0
			? (LAYOUT_LIMITS.minBottomGroupWidth / size.width) * 100
			: Math.min(4, equalShare);
	const foldedSpacerPercent = Math.max(0, 100 - foldedCount * foldedPercent);
	return (
		<aside
			ref={size.ref}
			aria-label="Bottom workbench"
			data-testid="bottom-panel"
			className="relative h-full min-h-0 min-w-0 overflow-hidden"
		>
			<ResizablePanelGroup
				key={tupleKey(
					"bottom-stack",
					String(projectionEpoch),
					...region.groups.flatMap((group) => [group.id, String(group.folded)]),
				)}
				direction="horizontal"
				onLayout={(sizes) => resize.onLayout(sizes.slice(0, region.groups.length))}
			>
				{region.groups.map((group, index) => {
					const sizePercent = group.folded ? foldedPercent : current[index];
					const fold = () => {
						const result = setAuxiliaryGroupFolded(
							shared.document,
							"bottom",
							group.id,
							!group.folded,
						);
						if (isLayoutUnavailable(result)) return;
						const selectedId = readLayoutSelection(shared.attention, group.id);
						const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
						shared.onApply({
							...result,
							focusGroupId: group.id,
							...(group.folded && selected ? { focusTabId: selected.id } : {}),
						});
					};
					return (
						<PanelWithHandle
							key={tupleKey("bottom-group", group.id)}
							id={tupleKey("bottom-stack-panel", group.id)}
							order={index + 1}
							defaultSize={sizePercent}
							minSize={group.folded ? foldedPercent : expandedMinimum}
							maxSize={group.folded ? foldedPercent : 100}
							showHandle={index < region.groups.length - 1}
							handleDirection="horizontal"
							handleTestId="bottom-group-resize"
							handleDisabled={!roomForMinimums || expandedCount < 2}
							onDragging={resize.onDragging}
							onKeyboard={resize.onKeyboard}
							onKeyboardEnd={resize.onKeyboardEnd}
						>
							{group.folded ? (
								<BottomFoldedGroup
									group={group}
									groupIndex={index}
									showAlignmentMenu={group.id === alignmentMenuGroupId}
									onExpand={fold}
									onAlignmentChange={commitAlignment}
									shared={shared}
								/>
							) : (
								<BottomGroupView
									group={group}
									groupIndex={index}
									showAlignmentMenu={group.id === alignmentMenuGroupId}
									onFold={fold}
									onNewTerminal={() => onNewTerminal(group.id, "bottom")}
									onAlignmentChange={commitAlignment}
									{...shared}
								/>
							)}
						</PanelWithHandle>
					);
				})}
				{expandedCount === 0 && foldedSpacerPercent > 0 ? (
					<ResizablePanel
						id="bottom-folded-spacer"
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

function BottomAlignedRow({
	document,
	children,
}: {
	document: WorkspaceLayoutDocument;
	children: ReactNode;
}) {
	return (
		<div
			data-testid="bottom-aligned-row"
			data-alignment={document.bottom.alignment}
			className="h-full min-h-0 min-w-0"
		>
			{children}
		</div>
	);
}

function HiddenBottomRail({
	onShow,
	dropEnabled,
	targetGroupId,
	targetIndex,
}: {
	onShow: () => void;
	dropEnabled: boolean;
	targetGroupId: string | undefined;
	targetIndex: number;
}) {
	const drop = useDroppable({
		id: "dnd-hidden-bottom-edge",
		data: {
			target: targetGroupId
				? ({
						kind: "group",
						location: { area: "bottom", groupId: targetGroupId },
					} satisfies DropTarget)
				: ({ kind: "auxiliary-edge", region: "bottom", index: targetIndex } satisfies DropTarget),
		},
		disabled: !dropEnabled,
	});
	return (
		<div
			ref={drop.setNodeRef}
			data-testid="bottom-layout-rail"
			data-drop-label={dropEnabled ? "Create group in hidden bottom region" : undefined}
			data-drop-active={drop.isOver || undefined}
			className="flex h-28 shrink-0 items-center justify-center border-border-default border-t bg-container-sidebar-bg data-[drop-active]:bg-primary-subtle data-[drop-active]:ring-2 data-[drop-active]:ring-inset data-[drop-active]:ring-primary"
		>
			<button
				type="button"
				aria-label="Show bottom panel"
				title="Show bottom panel (Mod+Shift+J)"
				onClick={onShow}
				className="flex h-24 items-center gap-4 rounded-[var(--radius-sm)] px-8 tr-text-metadata text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				<PanelBottomOpen className="size-16" /> Bottom
			</button>
		</div>
	);
}

function PanelWithHandle({
	children,
	showHandle,
	handleDirection = "vertical",
	handleTestId,
	handleDisabled,
	onDragging,
	onKeyboard,
	onKeyboardEnd,
	...panelProps
}: React.ComponentProps<typeof ResizablePanel> & {
	showHandle: boolean;
	handleDirection?: "horizontal" | "vertical";
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
					direction={handleDirection}
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
		data: {
			target: { kind: "auxiliary-edge", region: side, index: targetIndex } satisfies DropTarget,
		},
		disabled: !dropEnabled,
	});
	return (
		<div
			ref={drop.setNodeRef}
			data-testid={`${side}-layout-rail`}
			data-drop-label={dropEnabled ? `Create ${side} group in hidden side` : undefined}
			data-drop-active={drop.isOver || undefined}
			className="flex w-28 shrink-0 flex-col items-center border-border-default bg-container-sidebar-bg py-4 first:border-r last:border-l data-[drop-active]:bg-primary-subtle data-[drop-active]:ring-2 data-[drop-active]:ring-inset data-[drop-active]:ring-primary"
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

export function Workbench({
	document,
	attention,
	maxSideGroups,
	maxBottomGroups,
	projectionEpoch,
	focusRequest,
	renderTabBody,
	renderTabAdornment,
	renderToolBody,
	renderEmptyCenter,
	renderCenterActions,
	renderSideMenuActions,
	onCommit,
	onAttentionChange,
	onUserNavigation,
	readNavigationTick,
	onRequestClose,
	onNewChat,
	onNewTerminal,
	onGestureCanceled,
}: WorkbenchProps) {
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
	const [draggingTab, setDraggingTab] = useState<LayoutTab | null>(null);
	const tabSelectionEpoch = useRef(0);
	const selectionProjectionEpoch = useRef(projectionEpoch);
	if (selectionProjectionEpoch.current !== projectionEpoch) {
		selectionProjectionEpoch.current = projectionEpoch;
		tabSelectionEpoch.current += 1;
	}
	const { ref: workbenchRef, width: workbenchWidth, height: workbenchHeight } = useElementSize();
	const [focusAfterClose, setFocusAfterClose] = useState<{
		closedTab: LayoutTab;
		fallbackDomId: string;
	} | null>(null);
	const documentRef = useRef(document);
	const attentionRef = useRef(attention);
	documentRef.current = document;
	attentionRef.current = attention;
	const [localFocusRequest, setLocalFocusRequest] = useState<LayoutTabFocusRequest | null>(null);
	const dragStartEpoch = useRef(projectionEpoch);
	const canceled = useRef(false);

	useEffect(() => {
		if (!focusRequest) return;
		const frame = requestAnimationFrame(() => focusLayoutRequest(focusRequest));
		return () => cancelAnimationFrame(frame);
	}, [focusRequest]);

	useEffect(() => {
		if (!localFocusRequest) return;
		const frame = requestAnimationFrame(() => focusLayoutRequest(localFocusRequest));
		return () => cancelAnimationFrame(frame);
	}, [localFocusRequest]);

	useEffect(() => {
		if (!draggingTab || dragStartEpoch.current === projectionEpoch) return;
		canceled.current = true;
		setDraggingTab(null);
		onGestureCanceled?.();
	}, [draggingTab, onGestureCanceled, projectionEpoch]);

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
			const focusGroupId = result.focusGroupId;
			if (focusGroupId) {
				const location = result.focusTabId
					? findTabLocation(result.document, result.focusTabId)
					: findCenterGroup(result.document.center, focusGroupId)
						? ({ area: "center", groupId: focusGroupId } as const)
						: ((["left", "right", "bottom"] as const)
								.map((area) =>
									findAuxiliaryGroup(result.document, area, focusGroupId)
										? ({ area, groupId: focusGroupId } as const)
										: null,
								)
								.find((candidate) => candidate !== null) ?? null);
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
			const requestedNavigationTick = readNavigationTick();
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
							readNavigationTick() !== requestedNavigationTick ||
							[...clockGroups].some(
								(groupId) =>
									survivingGroupIds.has(groupId) &&
									(readLayoutNavigationClock(requestedAttention, groupId) ?? 0) !==
										(readLayoutNavigationClock(latestAttention, groupId) ?? 0),
							);
						const countsAsNavigation =
							(wasSelectedAtRequest || closeControlHadFocusAtRequest) && !navigationWasOvertaken;
						let focusLocation: LayoutGroupLocation | null = null;
						if (
							countsAsNavigation &&
							location &&
							location.area !== "center" &&
							acceptedDocument[location.area].visible
						) {
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
		[onAttentionChange, onRequestClose, onUserNavigation, readNavigationTick],
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
		dragStartEpoch.current = projectionEpoch;
		canceled.current = false;
		setDraggingTab(data.tab);
	};
	const handleDragEnd = (event: DragEndEvent) => {
		const tab = draggingTab;
		setDraggingTab(null);
		if (!tab || canceled.current || dragStartEpoch.current !== projectionEpoch) return;
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
			case "auxiliary-edge":
				result =
					tab.kind === "terminal" || tab.kind === "tool"
						? createAuxiliaryGroup(
								document,
								target.region,
								tab,
								target.index,
								target.region === "bottom" ? maxBottomGroups : maxSideGroups,
							)
						: { reason: "That tab type cannot move to an auxiliary region." };
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
	const leftOwnsBottomCorner =
		leftVisible &&
		document.bottom.alignment !== "center-left" &&
		document.bottom.alignment !== "full";
	const rightOwnsBottomCorner =
		rightVisible &&
		document.bottom.alignment !== "center-right" &&
		document.bottom.alignment !== "full";
	const leftInAlignedRow = leftVisible && !leftOwnsBottomCorner;
	const rightInAlignedRow = rightVisible && !rightOwnsBottomCorner;
	const globalLeftCurrent = leftVisible ? document.left.width * 100 : 0;
	const globalRightCurrent = rightVisible ? document.right.width * 100 : 0;
	const alignedWidthCurrent =
		100 -
		(leftOwnsBottomCorner ? globalLeftCurrent : 0) -
		(rightOwnsBottomCorner ? globalRightCurrent : 0);
	const outerCurrent = useMemo(
		() => [
			...(leftOwnsBottomCorner ? [globalLeftCurrent] : []),
			alignedWidthCurrent,
			...(rightOwnsBottomCorner ? [globalRightCurrent] : []),
		],
		[
			alignedWidthCurrent,
			globalLeftCurrent,
			globalRightCurrent,
			leftOwnsBottomCorner,
			rightOwnsBottomCorner,
		],
	);
	const outerTopology = tupleKey(
		"outer-workbench",
		String(leftOwnsBottomCorner),
		String(rightOwnsBottomCorner),
		String(projectionEpoch),
	);
	const [alignedProjection, setAlignedProjection] = useState({
		topology: outerTopology,
		width: alignedWidthCurrent,
	});
	const projectedAlignedWidth =
		alignedProjection.topology === outerTopology ? alignedProjection.width : alignedWidthCurrent;
	const activeSideResize = useRef<LayoutSide | null>(null);
	const commitSideSizes = useCallback(
		(entries: ReadonlyArray<readonly [LayoutSide, number]>) => {
			let next = document;
			const collapsedSides: LayoutSide[] = [];
			for (const [side, size] of entries) {
				if (size <= Number.EPSILON) collapsedSides.push(side);
				else next = resizeSideRegion(next, side, size / 100);
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
		[apply, document, onCommit],
	);
	const outerGroupRef = useRef<ImperativePanelGroupHandle>(null);
	useEffect(() => {
		const group = outerGroupRef.current;
		if (group && !sameSizes(group.getLayout(), outerCurrent)) group.setLayout(outerCurrent);
	}, [outerCurrent]);
	const outerResize = useCommittedSizes(
		outerCurrent,
		projectionEpoch,
		(sizes) => {
			const side = activeSideResize.current;
			if (side === "left" && leftOwnsBottomCorner) {
				commitSideSizes([["left", sizes[0] ?? globalLeftCurrent]]);
			}
			if (side === "right" && rightOwnsBottomCorner) {
				commitSideSizes([["right", sizes.at(-1) ?? globalRightCurrent]]);
			}
		},
		onGestureCanceled,
	);
	const projectOuterLayout = useCallback(
		(sizes: number[]) => {
			const alignedIndex = leftOwnsBottomCorner ? 1 : 0;
			const width = sizes[alignedIndex] ?? alignedWidthCurrent;
			setAlignedProjection((current) =>
				current.topology === outerTopology && Math.abs(current.width - width) < 0.01
					? current
					: { topology: outerTopology, width },
			);
			outerResize.onLayout(sizes);
		},
		[alignedWidthCurrent, leftOwnsBottomCorner, outerResize.onLayout, outerTopology],
	);
	const alignedRowCurrent = useMemo(() => {
		const widths = [
			...(leftInAlignedRow ? [globalLeftCurrent] : []),
			Math.max(
				Number.EPSILON,
				projectedAlignedWidth -
					(leftInAlignedRow ? globalLeftCurrent : 0) -
					(rightInAlignedRow ? globalRightCurrent : 0),
			),
			...(rightInAlignedRow ? [globalRightCurrent] : []),
		];
		const total = widths.reduce((sum, width) => sum + width, 0);
		return widths.map((width) => (width / total) * 100);
	}, [
		globalLeftCurrent,
		globalRightCurrent,
		leftInAlignedRow,
		projectedAlignedWidth,
		rightInAlignedRow,
	]);
	const alignedRowGroupRef = useRef<ImperativePanelGroupHandle>(null);
	useEffect(() => {
		const group = alignedRowGroupRef.current;
		if (group && !sameSizes(group.getLayout(), alignedRowCurrent, 0.01)) {
			group.setLayout(alignedRowCurrent);
		}
	}, [alignedRowCurrent]);
	const alignedRowResize = useCommittedSizes(
		alignedRowCurrent,
		projectionEpoch,
		(sizes) => {
			const side = activeSideResize.current;
			if (side === "left" && leftInAlignedRow) {
				commitSideSizes([["left", ((sizes[0] ?? 0) * projectedAlignedWidth) / 100]]);
			}
			if (side === "right" && rightInAlignedRow) {
				commitSideSizes([["right", ((sizes.at(-1) ?? 0) * projectedAlignedWidth) / 100]]);
			}
		},
		onGestureCanceled,
	);
	const outerLeftResize = bindSideResize("left", outerResize, activeSideResize);
	const outerRightResize = bindSideResize("right", outerResize, activeSideResize);
	const alignedLeftResize = bindSideResize("left", alignedRowResize, activeSideResize);
	const alignedRightResize = bindSideResize("right", alignedRowResize, activeSideResize);
	const bottomVisible = document.bottom.visible && document.bottom.groups.length > 0;
	const hiddenBottomTargetGroupId =
		document.bottom.groups.find((group) => group.id === attention.lastFocusedSideGroupId.bottom)
			?.id ?? document.bottom.groups.at(-1)?.id;
	const bottomCurrent = useMemo(
		() => [(1 - document.bottom.height) * 100, document.bottom.height * 100],
		[document.bottom.height],
	);
	const bottomGroupRef = useRef<ImperativePanelGroupHandle>(null);
	useEffect(() => {
		const group = bottomGroupRef.current;
		if (group && !sameSizes(group.getLayout(), bottomCurrent)) group.setLayout(bottomCurrent);
	}, [bottomCurrent]);
	const bottomResize = useCommittedSizes(
		bottomCurrent,
		projectionEpoch,
		(sizes) => {
			const bottomSize = sizes[1] ?? bottomCurrent[1] ?? 30;
			if (bottomSize <= Number.EPSILON) {
				apply(hideBottom(document, attentionRef.current));
				return;
			}
			const next = resizeBottomRegion(document, bottomSize / 100);
			if (next !== document) onCommit(next);
		},
		onGestureCanceled,
	);
	const bottomMinimumPercent = Math.min(
		LAYOUT_LIMITS.maxBottomHeight * 100,
		workbenchHeight > 0
			? ((LAYOUT_LIMITS.minBottomBodyHeight + LAYOUT_LIMITS.foldedSideHeight) / workbenchHeight) *
					100
			: 10,
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
					...(target.tabControlsRendered ? { tabId: selected.id } : {}),
				});
				return;
			}
			if (target.location.area !== "center") {
				onAttentionChange({
					...currentAttention,
					lastFocusedSideGroupId: Object.assign(
						Object.create(null),
						currentAttention.lastFocusedSideGroupId,
						{ [target.location.area]: target.location.groupId },
					),
				});
				setLocalFocusRequest({
					key: createLayoutId("focus-group"),
					location: target.location,
				});
				return;
			}
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
		(region: LayoutAuxiliaryRegion) =>
			apply(
				region === "bottom"
					? hideBottom(document, attentionRef.current)
					: hideSide(document, region, attentionRef.current),
			),
		[apply, document],
	);
	const showBottomRegion = useCallback(() => {
		const shown = showBottom(document, maxSideGroups, maxBottomGroups, attentionRef.current);
		if (isLayoutUnavailable(shown)) return;
		apply(shown);
		if (shown.document.bottom.groups.every((group) => group.tabs.length === 0)) {
			const groupId = shown.focusGroupId ?? shown.document.bottom.groups[0]?.id;
			if (groupId) onNewTerminal(groupId, "bottom");
		}
	}, [apply, document, maxBottomGroups, maxSideGroups, onNewTerminal]);
	const revealMissingTool = useCallback(
		(tool: LayoutToolId) => {
			const result = revealTool(document, tool, maxSideGroups, maxBottomGroups);
			if (!isLayoutUnavailable(result)) apply(result);
		},
		[apply, document, maxBottomGroups, maxSideGroups],
	);
	const shared: SharedGroupProps = {
		document,
		attention,
		selectionEpoch: tabSelectionEpoch,
		maxSideGroups,
		maxBottomGroups,
		draggingTab,
		renderTabBody,
		renderTabAdornment,
		renderToolBody,
		renderSideMenuActions,
		onAttentionChange,
		onUserNavigation,
		onGestureCanceled,
		onApply: apply,
		onClose: close,
		onFocusAdjacentGroup: focusAdjacentGroup,
		onHideSide: hideSideRegion,
		onRevealTool: revealMissingTool,
		canFocusAdjacentGroup,
	};
	const alignedWidth = Math.max(Number.EPSILON, projectedAlignedWidth);
	const alignedSideMinimum = Math.min(100, (8 / alignedWidth) * 100);
	const alignedCenterMinimum = Math.min(100, (centerMinimumPercent / alignedWidth) * 100);
	const alignedColumnMinimum = Math.min(
		100,
		centerMinimumPercent + (leftInAlignedRow ? 8 : 0) + (rightInAlignedRow ? 8 : 0),
	);
	const sideStack = (side: LayoutSide) => (
		<SideStack
			side={side}
			region={document[side]}
			projectionEpoch={projectionEpoch}
			onCommit={onCommit}
			{...shared}
		/>
	);
	const centerView = (
		<main data-testid="center-tabs" className="h-full min-h-0 min-w-0">
			<CenterNodeView
				node={document.center}
				projectionEpoch={projectionEpoch}
				onCommit={onCommit}
				onNewChat={onNewChat}
				renderEmptyCenter={renderEmptyCenter}
				renderCenterActions={renderCenterActions}
				{...shared}
			/>
		</main>
	);
	const alignedTopRow = (
		<ResizablePanelGroup
			ref={alignedRowGroupRef}
			key={tupleKey(
				"aligned-workbench-row",
				String(leftInAlignedRow),
				String(rightInAlignedRow),
				String(projectionEpoch),
			)}
			direction="horizontal"
			onLayout={alignedRowResize.onLayout}
			className="h-full min-h-0 min-w-0"
		>
			{leftInAlignedRow ? (
				<>
					<ResizablePanel
						id="layout-left"
						order={1}
						defaultSize={alignedRowCurrent[0]}
						minSize={alignedSideMinimum}
						collapsedSize={0}
						collapsible
					>
						{sideStack("left")}
					</ResizablePanel>
					<ResizableHandle
						direction="horizontal"
						data-testid="resize-left"
						onDragging={alignedLeftResize.onDragging}
						onKeyDownCapture={alignedLeftResize.onKeyboard}
						onKeyUpCapture={alignedLeftResize.onKeyboardEnd}
					/>
				</>
			) : null}
			<ResizablePanel
				id="layout-center"
				order={2}
				defaultSize={alignedRowCurrent[leftInAlignedRow ? 1 : 0]}
				minSize={alignedCenterMinimum}
			>
				{centerView}
			</ResizablePanel>
			{rightInAlignedRow ? (
				<>
					<ResizableHandle
						direction="horizontal"
						data-testid="resize-right"
						onDragging={alignedRightResize.onDragging}
						onKeyDownCapture={alignedRightResize.onKeyboard}
						onKeyUpCapture={alignedRightResize.onKeyboardEnd}
					/>
					<ResizablePanel
						id="layout-right"
						order={3}
						defaultSize={alignedRowCurrent[alignedRowCurrent.length - 1]}
						minSize={alignedSideMinimum}
						collapsedSize={0}
						collapsible
					>
						{sideStack("right")}
					</ResizablePanel>
				</>
			) : null}
		</ResizablePanelGroup>
	);
	const alignedColumn = bottomVisible ? (
		<ResizablePanelGroup
			ref={bottomGroupRef}
			key={tupleKey("workbench-bottom", String(projectionEpoch))}
			direction="vertical"
			onLayout={bottomResize.onLayout}
			className="min-h-0 min-w-0 flex-1"
		>
			<ResizablePanel id="layout-main-row" order={1} defaultSize={bottomCurrent[0]} minSize={30}>
				{alignedTopRow}
			</ResizablePanel>
			<ResizableHandle
				direction="vertical"
				data-testid="resize-bottom"
				onDragging={bottomResize.onDragging}
				onKeyDownCapture={bottomResize.onKeyboard}
				onKeyUpCapture={bottomResize.onKeyboardEnd}
			/>
			<ResizablePanel
				id="layout-bottom"
				order={2}
				defaultSize={bottomCurrent[1]}
				minSize={bottomMinimumPercent}
				maxSize={LAYOUT_LIMITS.maxBottomHeight * 100}
				collapsedSize={0}
				collapsible
			>
				<BottomAlignedRow document={document}>
					<BottomStack
						projectionEpoch={projectionEpoch}
						onCommit={onCommit}
						onNewTerminal={onNewTerminal}
						{...shared}
					/>
				</BottomAlignedRow>
			</ResizablePanel>
		</ResizablePanelGroup>
	) : (
		<div className="flex h-full min-h-0 min-w-0 flex-col">
			<div className="min-h-0 min-w-0 flex-1">{alignedTopRow}</div>
			<div className="h-28 shrink-0">
				<BottomAlignedRow document={document}>
					<HiddenBottomRail
						onShow={showBottomRegion}
						dropEnabled={
							!!draggingTab &&
							canPlaceLayoutTab(draggingTab, "bottom") &&
							(hiddenBottomTargetGroupId !== undefined ||
								canCreateAuxiliaryGroup(
									document,
									"bottom",
									draggingTab,
									maxBottomGroups,
									document.bottom.groups.length,
								))
						}
						targetGroupId={hiddenBottomTargetGroupId}
						targetIndex={document.bottom.groups.length}
					/>
				</BottomAlignedRow>
			</div>
		</div>
	);
	const workbenchColumns = (
		<ResizablePanelGroup
			ref={outerGroupRef}
			key={outerTopology}
			direction="horizontal"
			onLayout={projectOuterLayout}
			className="h-full min-h-0 min-w-0 flex-1"
		>
			{leftOwnsBottomCorner ? (
				<>
					<ResizablePanel
						id="layout-left"
						order={1}
						defaultSize={outerCurrent[0]}
						minSize={8}
						collapsedSize={0}
						collapsible
					>
						{sideStack("left")}
					</ResizablePanel>
					<ResizableHandle
						direction="horizontal"
						data-testid="resize-left"
						onDragging={outerLeftResize.onDragging}
						onKeyDownCapture={outerLeftResize.onKeyboard}
						onKeyUpCapture={outerLeftResize.onKeyboardEnd}
					/>
				</>
			) : null}
			<ResizablePanel
				id="layout-aligned-column"
				order={2}
				defaultSize={outerCurrent[leftOwnsBottomCorner ? 1 : 0]}
				minSize={alignedColumnMinimum}
			>
				{alignedColumn}
			</ResizablePanel>
			{rightOwnsBottomCorner ? (
				<>
					<ResizableHandle
						direction="horizontal"
						data-testid="resize-right"
						onDragging={outerRightResize.onDragging}
						onKeyDownCapture={outerRightResize.onKeyboard}
						onKeyUpCapture={outerRightResize.onKeyboardEnd}
					/>
					<ResizablePanel
						id="layout-right"
						order={3}
						defaultSize={outerCurrent[outerCurrent.length - 1]}
						minSize={8}
						collapsedSize={0}
						collapsible
					>
						{sideStack("right")}
					</ResizablePanel>
				</>
			) : null}
		</ResizablePanelGroup>
	);

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
				{workbenchColumns}
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
					<div className="flex max-w-224 items-center gap-4 rounded-[var(--radius-sm)] border border-primary bg-container-elevated-bg px-8 py-4 tr-text-ui text-text-default shadow-lg">
						{tabIcon(draggingTab)}
						<span className="truncate">{layoutTabName(draggingTab)}</span>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
