import { type CollisionDetection, pointerWithin, useDroppable } from "@dnd-kit/core";
import {
	RiFileLine as File,
	RiGitPullRequestLine as GitCompareArrows,
	RiListCheck3 as ListTodo,
	RiLayout2Line as PanelsTopLeft,
	RiBookOpenFill,
	RiBookOpenLine,
	RiChat2Fill,
	RiChat2Line,
	RiDiscussFill,
	RiDiscussLine,
	RiFileFill,
	RiFolder2Fill,
	RiFolder2Line,
	RiGitPullRequestFill,
	RiLayout2Fill,
	RiTerminalBoxFill,
	RiTerminalBoxLine as SquareTerminal,
} from "@remixicon/react";
import { ResizableHandle, ResizablePanel } from "@thinkrail/ui/resizable";
import {
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useInsertionEffect,
	useRef,
	useState,
} from "react";
import { CustomIcon } from "../../components/CustomIcon";
import { type LayoutAttention, readLayoutNavigationClock, tupleKey } from "../../lib";
import {
	type CenterSplitDirection,
	canPlaceLayoutTab,
	collectCenterGroups,
	findCenterGroup,
	findTabLocation,
	type LayoutGroupLocation,
	type LayoutMutationResult,
	type LayoutSide,
	layoutTabName,
} from "./model";
import type {
	LayoutAuxiliaryRegion,
	LayoutCenterTab,
	LayoutSideTab,
	LayoutTab,
	LayoutToolId,
	WorkspaceLayoutDocument,
} from "./types";
export interface LayoutTabFocusRequest {
	key: string;
	location: LayoutGroupLocation;
	tabId?: string;
}

export interface PreparedLayoutClose {
	document: WorkspaceLayoutDocument;
	onAccepted: (current?: { document: WorkspaceLayoutDocument; attention: LayoutAttention }) => void;
}

export interface WorkbenchProps {
	document: WorkspaceLayoutDocument;
	attention: LayoutAttention;
	maxSideGroups: number;
	maxBottomGroups: number;
	projectionEpoch: number;
	focusRequest?: LayoutTabFocusRequest;
	subscribeCloseRequest?: (listener: () => void) => () => void;
	renderTabBody: (tab: LayoutCenterTab | Extract<LayoutSideTab, { kind: "terminal" }>) => ReactNode;
	renderTabAdornment: (tab: LayoutTab) => ReactNode;
	renderToolBody: (tool: LayoutToolId) => ReactNode;
	renderEmptyCenter: (groupId: string) => ReactNode;
	renderCenterActions: (groupId: string) => ReactNode;
	renderSideMenuActions: (side: LayoutSide, groupId: string) => ReactNode;
	onCommit: (document: WorkspaceLayoutDocument) => void;
	onAttentionChange: (attention: LayoutAttention) => void;
	onUserNavigation: () => void;
	onDirectTabActivation?: (tab: LayoutTab) => void;
	readNavigationTick: () => number;
	onRequestClose: (
		tab: LayoutTab,
		prepare: (latestDocument?: WorkspaceLayoutDocument) => PreparedLayoutClose,
	) => void;
	onRenameChat?: (sessionId: string, titleInput: string, currentTitle: string) => void;
	onNewChat: (groupId: string) => void;
	onNewTerminal: (groupId: string, area: "center" | LayoutAuxiliaryRegion) => void;
	onGestureCanceled?: () => void;
}

export type DropTarget =
	| { kind: "group"; location: LayoutGroupLocation }
	| { kind: "insert"; location: LayoutGroupLocation; index: number }
	| { kind: "split"; groupId: string; direction: CenterSplitDirection }
	| { kind: "auxiliary-edge"; region: LayoutAuxiliaryRegion; index: number };

export interface DragData {
	tab: LayoutTab;
}

export const HIDDEN_BOTTOM_DROP_ID = "dnd-hidden-bottom-edge";

export const workbenchCollisionDetection: CollisionDetection = (args) => {
	const collisions = pointerWithin(args);
	const bottomCollision = collisions.find((collision) => collision.id === HIDDEN_BOTTOM_DROP_ID);
	if (!bottomCollision) return collisions;
	return [
		bottomCollision,
		...collisions.filter((collision) => collision.id !== HIDDEN_BOTTOM_DROP_ID),
	];
};

export function sameSizes(
	first: readonly number[],
	second: readonly number[],
	tolerance = 0.15,
): boolean {
	return (
		first.length === second.length &&
		first.every((value, index) => Math.abs(value - (second[index] ?? 0)) < tolerance)
	);
}

export function isResizeArrowKey(key: string): boolean {
	return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key);
}

export function useCommittedSizes(
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
	const epoch = useRef(projectionEpoch);
	const currentRef = useRef(current);
	const commitRef = useRef(commit);
	useInsertionEffect(() => {
		epoch.current = projectionEpoch;
		currentRef.current = current;
		commitRef.current = commit;
	});

	const cancelStaleGesture = useCallback(() => {
		const active = dragging.current || keyboard.current;
		if (!active || startEpoch.current === epoch.current) return false;
		dragging.current = false;
		keyboard.current = false;
		pending.current = null;
		onCanceled?.();
		return true;
	}, [onCanceled]);

	useEffect(() => {
		if (startEpoch.current !== projectionEpoch) cancelStaleGesture();
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

export function useSideResizeBinder() {
	const activeSide = useRef<LayoutSide | null>(null);
	const bind = (side: LayoutSide, resize: ReturnType<typeof useCommittedSizes>) => ({
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
	});
	return [activeSide, bind] as const;
}

export function useElementSize(): [
	React.RefObject<HTMLDivElement | null>,
	{ width: number; height: number },
] {
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
	return [ref, size];
}

export interface HorizontalOverflow {
	before: boolean;
	after: boolean;
}

export function useHorizontalOverflow(
	ref: React.RefObject<HTMLDivElement | null>,
): HorizontalOverflow {
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

export function tabSearchKeywords(tab: LayoutTab): string[] {
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

export function tabIcon(tab: LayoutTab, active = false): ReactNode {
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

export function encodedElementId(namespace: string, ...parts: string[]): string {
	return encodeURIComponent(tupleKey(namespace, ...parts));
}

export function groupPanelId(location: LayoutGroupLocation): string {
	return encodedElementId("layout-panel", location.area, location.groupId);
}

export function tabDomId(location: LayoutGroupLocation, tabId: string): string {
	return encodedElementId("layout-tab", location.area, location.groupId, tabId);
}

export function groupDomId(location: LayoutGroupLocation): string {
	return encodedElementId("layout-group", location.area, location.groupId);
}

export function focusLayoutRequest(request: LayoutTabFocusRequest): void {
	const tab = request.tabId
		? globalThis.document.getElementById(tabDomId(request.location, request.tabId))
		: null;
	(tab ?? globalThis.document.getElementById(groupDomId(request.location)))?.focus();
}

export function navigationClockSnapshot(attention: LayoutAttention): string {
	return JSON.stringify(
		Object.keys(attention.navigationClockByGroup)
			.sort()
			.map((groupId) => [groupId, readLayoutNavigationClock(attention, groupId) ?? 0]),
	);
}

export function visibleFocusableGroups(document: WorkspaceLayoutDocument): Array<{
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

export function canInsertDraggedTab(
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

export function DropZone({
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
			data-drop-hint={!isOver || undefined}
			data-drop-label={label}
			className={`pointer-events-auto z-20 rounded-[var(--radius-sm)] border border-transparent transition-colors data-[drop-hint]:border-primary-soft data-[drop-hint]:bg-primary-subtle data-[drop-active]:border-primary data-[drop-active]:bg-primary-soft ${className}`}
		/>
	);
}

export function CenterSplitTarget({
	groupId,
	direction,
	label,
	edgeClassName,
	halfClassName,
}: {
	groupId: string;
	direction: CenterSplitDirection;
	label: string;
	edgeClassName: string;
	halfClassName: string;
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: tupleKey("dnd-split", groupId, direction),
		data: { target: { kind: "split", groupId, direction } satisfies DropTarget },
	});
	return (
		<>
			<div
				aria-hidden="true"
				data-drop-active={isOver || undefined}
				className={`pointer-events-none absolute z-10 rounded-[var(--radius-sm)] border-2 border-transparent transition-colors data-[drop-active]:border-primary data-[drop-active]:bg-primary-soft ${halfClassName}`}
			/>
			<div
				ref={setNodeRef}
				aria-hidden="true"
				data-drop-label={label}
				data-drop-active={isOver || undefined}
				data-drop-hint={!isOver || undefined}
				className={`pointer-events-auto absolute z-20 rounded-[var(--radius-sm)] border border-transparent transition-colors data-[drop-hint]:border-primary-soft data-[drop-hint]:bg-primary-subtle ${edgeClassName}`}
			/>
		</>
	);
}

export function findLayoutGroupTabs(
	document: WorkspaceLayoutDocument,
	location: LayoutGroupLocation,
): LayoutTab[] | null {
	if (location.area === "center")
		return findCenterGroup(document.center, location.groupId)?.tabs ?? null;
	return (
		document[location.area].groups.find((group) => group.id === location.groupId)?.tabs ?? null
	);
}

export interface SharedGroupProps {
	document: WorkspaceLayoutDocument;
	readAttention: () => LayoutAttention;
	selectionEpochRef: React.MutableRefObject<number>;
	maxSideGroups: number;
	maxBottomGroups: number;
	draggingTab: LayoutTab | null;
	renderTabBody: WorkbenchProps["renderTabBody"];
	renderTabAdornment: WorkbenchProps["renderTabAdornment"];
	renderToolBody: WorkbenchProps["renderToolBody"];
	renderSideMenuActions: WorkbenchProps["renderSideMenuActions"];
	onGestureCanceled: (() => void) | undefined;
	onApply: (result: LayoutMutationResult) => void;
	onClose: (tab: LayoutTab) => void;
	onSelectTab: (
		location: LayoutGroupLocation,
		tabId: string,
		options?: { center?: boolean; keep?: boolean },
	) => void;
	onFocusGroup: (location: LayoutGroupLocation, selectedTabId?: string) => void;
	onFocusAdjacentGroup: (delta: -1 | 1, fromGroupId?: string) => void;
	onHideSide: (region: LayoutAuxiliaryRegion) => void;
	onRevealTool: (tool: LayoutToolId) => void;
	onRenameChat: WorkbenchProps["onRenameChat"];
	canFocusAdjacentGroup: boolean;
}

export const GroupTabBody = memo(function GroupTabBody({
	tab,
	renderTabBody,
	renderToolBody,
}: {
	tab: LayoutTab;
	renderTabBody: WorkbenchProps["renderTabBody"];
	renderToolBody: WorkbenchProps["renderToolBody"];
}) {
	if (tab.kind === "tool") return <>{renderToolBody(tab.tool)}</>;
	return <>{renderTabBody(tab)}</>;
});
GroupTabBody.displayName = "GroupTabBody";

export function PanelWithHandle({
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
