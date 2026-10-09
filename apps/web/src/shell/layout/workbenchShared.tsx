import { type CollisionDetection, pointerWithin, useDroppable } from "@dnd-kit/core";
import {
	type ImperativePanelGroupHandle,
	ResizableHandle,
	ResizablePanel,
} from "@thinkrail/ui/resizable";
import {
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useInsertionEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { type LayoutAttention, readLayoutNavigationClock, tupleKey } from "../../lib";
import type { AuxiliaryRailEntry } from "./auxiliaryPresentation";
import {
	type CenterSplitDirection,
	canJoinAuxiliaryGroup,
	canPlaceLayoutTab,
	collectCenterGroups,
	findAuxiliaryGroup,
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
	workspaceId: string;
	key: string;
	location: LayoutGroupLocation;
	tabId?: string;
}

export interface PreparedLayoutClose {
	document: WorkspaceLayoutDocument;
	onAccepted: (current?: { document: WorkspaceLayoutDocument; attention: LayoutAttention }) => void;
}

export interface WorkbenchProps {
	workspaceId: string;
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
	onCommit: (document: WorkspaceLayoutDocument, attention?: LayoutAttention) => void;
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
	onNewTerminal: (
		groupId: string,
		area: "center" | LayoutAuxiliaryRegion,
		options?: { newPaneBelow?: boolean },
	) => void;
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

export function useTopologySettled(topologyKey: string): boolean {
	const [settledKey, setSettledKey] = useState(topologyKey);
	const settled = settledKey === topologyKey;
	useLayoutEffect(() => {
		if (!settled) setSettledKey(topologyKey);
	}, [settled, topologyKey]);
	return settled;
}

export function useEnforcedLayout(
	groupRef: React.RefObject<ImperativePanelGroupHandle | null>,
	sizes: readonly number[],
	constraints: unknown,
	tolerance?: number,
): void {
	useLayoutEffect(() => {
		const group = groupRef.current;
		if (!group) return;
		const mounted = group.getLayout();
		if (mounted.length === sizes.length && !sameSizes(mounted, sizes, tolerance))
			group.setLayout([...sizes]);
	}, [constraints, groupRef, sizes, tolerance]);
}

export function isResizeArrowKey(key: string): boolean {
	return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key);
}

export function useCommittedSizes(
	current: readonly number[],
	projectionEpoch: string,
	groupRef: React.RefObject<ImperativePanelGroupHandle | null>,
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
	const canceled = useRef(false);
	const restoring = useRef(false);
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
	const restore = useCallback(() => {
		const group = groupRef.current;
		if (!group || group.getLayout().length !== currentRef.current.length) return;
		restoring.current = true;
		try {
			group.setLayout([...currentRef.current]);
		} finally {
			restoring.current = false;
		}
	}, [groupRef]);
	const cancelStaleGesture = useCallback(() => {
		const active = dragging.current || keyboard.current;
		if (!active || startEpoch.current === epoch.current) return false;
		canceled.current = true;
		dragging.current = false;
		keyboard.current = false;
		pending.current = null;
		restore();
		onCanceled?.();
		return true;
	}, [onCanceled, restore]);

	useLayoutEffect(() => {
		if (startEpoch.current !== projectionEpoch) cancelStaleGesture();
	}, [cancelStaleGesture, projectionEpoch]);

	const flush = useCallback(() => {
		const sizes = pending.current;
		pending.current = null;
		if (
			!sizes ||
			canceled.current ||
			startEpoch.current !== epoch.current ||
			sameSizes(sizes, currentRef.current)
		)
			return;
		commitRef.current(sizes);
	}, []);
	const onLayout = useCallback(
		(sizes: number[]) => {
			if (restoring.current || cancelStaleGesture()) return;
			if (canceled.current) {
				restore();
				return;
			}
			if (sameSizes(sizes, currentRef.current)) return;
			if (dragging.current) {
				pending.current = sizes;
				return;
			}
			if (!keyboard.current) return;
			keyboard.current = false;
			pending.current = sizes;
			flush();
		},
		[cancelStaleGesture, flush, restore],
	);

	const onDragging = useCallback(
		(active: boolean) => {
			if (active) {
				if (canceled.current) return;
				dragging.current = true;
				startEpoch.current = epoch.current;
				pending.current = null;
				return;
			}
			cancelStaleGesture();
			dragging.current = false;
			if (canceled.current) {
				restore();
				canceled.current = false;
				return;
			}
			flush();
		},
		[cancelStaleGesture, flush, restore],
	);
	const onKeyboard = useCallback((event: { key: string }) => {
		if (!isResizeArrowKey(event.key) || canceled.current) return;
		startEpoch.current = epoch.current;
		keyboard.current = true;
	}, []);
	const onKeyboardEnd = useCallback(() => {
		keyboard.current = false;
		pending.current = null;
		if (canceled.current) restore();
		canceled.current = false;
	}, [restore]);
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
	React.RefCallback<HTMLDivElement>,
	{ width: number; height: number },
] {
	const [size, setSize] = useState({ width: 0, height: 0 });
	const ref = useCallback<React.RefCallback<HTMLDivElement>>((element) => {
		if (!element) return;
		const update = () =>
			setSize((current) =>
				current.width === element.clientWidth && current.height === element.clientHeight
					? current
					: { width: element.clientWidth, height: element.clientHeight },
			);
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

export function railGroupDomId(location: LayoutGroupLocation): string {
	return encodedElementId("layout-rail-group", location.area, location.groupId);
}

export function railControlId(entry: AuxiliaryRailEntry): string {
	return entry.kind === "tool" && entry.tab && entry.groupId
		? tabDomId({ area: entry.region, groupId: entry.groupId }, entry.tab.id)
		: encodedElementId("layout-rail-control", entry.key);
}

export function focusLayoutRequest(request: LayoutTabFocusRequest): void {
	const tab = request.tabId
		? globalThis.document.getElementById(tabDomId(request.location, request.tabId))
		: null;
	const pane = globalThis.document.getElementById(groupDomId(request.location));
	const rail = globalThis.document
		.getElementById(railGroupDomId(request.location))
		?.querySelector<HTMLButtonElement>("button");
	[tab, pane, rail].find((element) => element && element.getClientRects().length > 0)?.focus();
}

export function useLayoutFocus(
	request: LayoutTabFocusRequest | null | undefined,
	workspaceId: string,
	workspaceRef: React.RefObject<string>,
): void {
	const consumed = useRef<string | null>(null);
	useEffect(() => {
		if (!request || consumed.current === request.key) return;
		consumed.current = request.key;
		if (request.workspaceId !== workspaceId) return;
		const frame = requestAnimationFrame(() => {
			if (workspaceRef.current === request.workspaceId) focusLayoutRequest(request);
		});
		return () => cancelAnimationFrame(frame);
	}, [request, workspaceId, workspaceRef]);
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
					tabControlsRendered: !group.folded,
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
					tabControlsRendered: !group.folded,
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
	if (!source || source.area !== location.area || source.groupId !== location.groupId) {
		if (location.area === "center") return true;
		const group = findAuxiliaryGroup(document, location.area, location.groupId);
		return !!group && canJoinAuxiliaryGroup(group, tab);
	}
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
	workspaceId: string;
	document: WorkspaceLayoutDocument;
	readAttention: () => LayoutAttention;
	selectionEpochRef: React.MutableRefObject<number>;
	maxSideGroups: number;
	maxBottomGroups: number;
	draggingTab: LayoutTab | null;
	renderTabBody: WorkbenchProps["renderTabBody"];
	renderTabAdornment: WorkbenchProps["renderTabAdornment"];
	renderToolBody: WorkbenchProps["renderToolBody"];
	onNewTerminal: WorkbenchProps["onNewTerminal"];
	onUserNavigation: WorkbenchProps["onUserNavigation"];
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
