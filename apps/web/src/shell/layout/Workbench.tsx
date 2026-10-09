import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	MeasuringStrategy,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	type ImperativePanelGroupHandle,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@thinkrail/ui/resizable";
import { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";
import { readLayoutNavigationClock, readLayoutSelection, tupleKey } from "../../lib";
import { projectWorkbenchRatio, restoreWorkbenchRatio } from "./auxiliaryPresentation";
import { closeRequestTarget } from "./closeRequest";
import {
	canCreateAuxiliaryGroup,
	canJoinAuxiliaryGroup,
	canPlaceLayoutTab,
	closePlacedResource,
	collectAllGroups,
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
	resizeBottomRegion,
	resizeSideRegion,
	revealTool,
	selectTab,
	setAuxiliaryGroupFolded,
	setBottomAlignment,
	splitCenterGroup,
} from "./model";
import { tabIcon } from "./tabIcon";
import type { LayoutAuxiliaryRegion, LayoutTab, LayoutToolId } from "./types";
import {
	BottomAlignedRow,
	BottomAlignmentMenu,
	BottomDropZone,
	BottomStack,
} from "./workbenchBottom";
import { CenterNodeView } from "./workbenchCenter";
import { AuxiliaryRegionRail } from "./workbenchRails";
import type {
	DragData,
	DropTarget,
	LayoutTabFocusRequest,
	SharedGroupProps,
	WorkbenchProps,
} from "./workbenchShared";
import {
	findLayoutGroupTabs,
	groupDomId,
	tabDomId,
	useCommittedSizes,
	useElementSize,
	useEnforcedLayout,
	useLayoutFocus,
	useSideResizeBinder,
	useTopologySettled,
	visibleFocusableGroups,
	workbenchCollisionDetection,
} from "./workbenchShared";
import { SideStack } from "./workbenchSide";

export type { LayoutTabFocusRequest, WorkbenchProps } from "./workbenchShared";

export function Workbench({
	workspaceId,
	document,
	attention,
	maxSideGroups,
	maxBottomGroups,
	projectionEpoch,
	focusRequest,
	subscribeCloseRequest,
	renderTabBody,
	renderTabAdornment,
	renderToolBody,
	renderEmptyCenter,
	renderCenterActions,
	onCommit,
	onAttentionChange,
	onUserNavigation,
	onDirectTabActivation,
	readNavigationTick,
	onRequestClose,
	onRenameChat,
	onNewChat,
	onNewTerminal,
	onGestureCanceled,
}: WorkbenchProps) {
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
	const [draggingTab, setDraggingTab] = useState<LayoutTab | null>(null);
	const tabSelectionEpoch = useRef(0);
	useInsertionEffect(() => {
		tabSelectionEpoch.current += 1;
	}, [projectionEpoch, workspaceId]);
	const [workbenchRef, { width: workbenchWidth, height: workbenchHeight }] = useElementSize();
	const [columnsRef, { width: columnsWidth }] = useElementSize();
	const [bottomBodyRef, { height: bottomBodyHeight }] = useElementSize();
	const gestureContext = tupleKey(workspaceId, String(projectionEpoch));
	const workspaceRef = useRef(workspaceId);
	const [focusAfterClose, setFocusAfterClose] = useState<{
		workspaceId: string;
		closedTab: LayoutTab;
		fallbackDomId: string;
	} | null>(null);
	const documentRef = useRef(document);
	const attentionRef = useRef(attention);
	useInsertionEffect(() => {
		documentRef.current = document;
		attentionRef.current = attention;
		workspaceRef.current = workspaceId;
	});
	const [localFocusRequest, setLocalFocusRequest] = useState<LayoutTabFocusRequest | null>(null);
	const dragStartEpoch = useRef(gestureContext);
	const canceled = useRef(false);
	useLayoutFocus(focusRequest, workspaceId, workspaceRef);
	useLayoutFocus(localFocusRequest, workspaceId, workspaceRef);

	useEffect(() => {
		if (!draggingTab) return;
		if (
			dragStartEpoch.current === gestureContext &&
			findTabLocation(document, draggingTab.id) !== null
		)
			return;
		canceled.current = true;
		setDraggingTab(null);
		onGestureCanceled?.();
	}, [document, draggingTab, onGestureCanceled, gestureContext]);

	const apply = useCallback(
		(result: LayoutMutationResult) => {
			let next = reconcileAttention(result.document, attentionRef.current, documentRef.current);
			if (result.focusGroupId && result.focusTabId) {
				const location = findTabLocation(result.document, result.focusTabId);
				if (location) next = selectTab(next, location, result.focusTabId, true, true);
			}
			onCommit(result.document, next);
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
						workspaceId,
						key: createLayoutId("focus"),
						location,
						...(result.focusTabId ? { tabId: result.focusTabId } : {}),
					});
				}
			}
		},
		[onCommit, workspaceId],
	);

	const selectTabInGroup = useCallback(
		(
			location: LayoutGroupLocation,
			tabId: string,
			options?: { center?: boolean; keep?: boolean },
		) => {
			const document = documentRef.current;
			const attention = attentionRef.current;
			if (!options?.center) {
				onAttentionChange(selectTab(attention, location, tabId));
				return;
			}
			onUserNavigation();
			const activated = findLayoutGroupTabs(document, location)?.find((tab) => tab.id === tabId);
			if (activated) onDirectTabActivation?.(activated);
			if (
				options.keep &&
				findCenterGroup(document.center, location.groupId)?.previewTabId === tabId
			) {
				const result = keepPreview(document, location.groupId, tabId);
				if (!isLayoutUnavailable(result)) {
					apply(result);
					return;
				}
			}
			onAttentionChange(selectTab(attention, location, tabId, true, true));
		},
		[apply, onAttentionChange, onDirectTabActivation, onUserNavigation],
	);

	const focusGroup = useCallback(
		(location: LayoutGroupLocation, selectedTabId?: string) => {
			const attention = attentionRef.current;
			if (selectedTabId) {
				onAttentionChange(selectTab(attention, location, selectedTabId, false));
				return;
			}
			if (location.area === "bottom") {
				onAttentionChange({
					...attention,
					lastFocusedSideGroupId: Object.assign(
						Object.create(null),
						attention.lastFocusedSideGroupId,
						{ bottom: location.groupId },
					),
				});
			}
		},
		[onAttentionChange],
	);

	const close = useCallback(
		(tab: LayoutTab) => {
			const requestedWorkspaceId = workspaceRef.current;
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
			onRequestClose(tab, (latestDocumentInput) => {
				const latestDocument = latestDocumentInput ?? documentRef.current;
				const placed = findPlacedResource(latestDocument, tab);
				const location = placed ? findTabLocation(latestDocument, placed.id) : null;
				const result = closePlacedResource(latestDocument, tab);
				return {
					document: result.document,
					onAccepted: (current) => {
						if (workspaceRef.current !== requestedWorkspaceId) return;
						const acceptedDocument = current?.document ?? result.document;
						const latestAttention = current?.attention ?? requestedAttention;
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
								workspaceId: requestedWorkspaceId,
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

	useEffect(
		() =>
			subscribeCloseRequest?.(() => {
				const activeElement = globalThis.document.activeElement;
				if (activeElement?.closest("[data-rail-entry]")) return;
				const focusedGroupId =
					activeElement?.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
				const tab = closeRequestTarget(documentRef.current, attentionRef.current, focusedGroupId);
				if (tab) close(tab);
			}),
		[close, subscribeCloseRequest],
	);

	useEffect(() => {
		const pending = focusAfterClose;
		if (!pending || pending.workspaceId !== workspaceId) return;
		if (findPlacedResource(document, pending.closedTab)) {
			setFocusAfterClose((current) => (current === pending ? null : current));
			return;
		}
		const frame = requestAnimationFrame(() => {
			if (workspaceRef.current !== pending.workspaceId) return;
			globalThis.document.getElementById(pending.fallbackDomId)?.focus();
			setFocusAfterClose((current) => (current === pending ? null : current));
		});
		return () => cancelAnimationFrame(frame);
	}, [document, focusAfterClose, workspaceId]);

	const handleDragStart = (event: DragStartEvent) => {
		const data = event.active.data.current as DragData | undefined;
		if (!data?.tab) return;
		tabSelectionEpoch.current += 1;
		dragStartEpoch.current = gestureContext;
		canceled.current = false;
		setDraggingTab(data.tab);
	};
	const handleDragEnd = (event: DragEndEvent) => {
		const tab = draggingTab;
		setDraggingTab(null);
		if (
			!tab ||
			canceled.current ||
			dragStartEpoch.current !== gestureContext ||
			findTabLocation(document, tab.id) === null
		)
			return;
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
		if (isLayoutUnavailable(result)) return;
		if (
			(target.kind === "group" || target.kind === "insert") &&
			target.location.area !== "center"
		) {
			const { area, groupId } = target.location;
			if (findAuxiliaryGroup(result.document, area, groupId)?.folded) {
				const unfolded = setAuxiliaryGroupFolded(result.document, area, groupId, false);
				if (!isLayoutUnavailable(unfolded)) result = { ...result, document: unfolded.document };
			}
		}
		apply(result);
	};

	const leftVisible = document.left.visible && document.left.groups.some((group) => !group.folded);
	const rightVisible =
		document.right.visible && document.right.groups.some((group) => !group.folded);
	const visibleSideMinimums = (leftVisible ? 8 : 0) + (rightVisible ? 8 : 0);
	const centerMinimumPercent = Math.min(
		Math.max(10, 100 - visibleSideMinimums),
		columnsWidth > 0 ? (LAYOUT_LIMITS.minCenterWidth / columnsWidth) * 100 : 10,
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
	const desiredLeft = leftVisible
		? projectWorkbenchRatio(document.left.width, workbenchWidth, columnsWidth) * 100
		: 0;
	const desiredRight = rightVisible
		? projectWorkbenchRatio(document.right.width, workbenchWidth, columnsWidth) * 100
		: 0;
	const sideCompression = Math.min(1, 90 / Math.max(Number.EPSILON, desiredLeft + desiredRight));
	const globalLeftCurrent = desiredLeft * sideCompression;
	const globalRightCurrent = desiredRight * sideCompression;
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
	const [activeSideResize, bindSideResize] = useSideResizeBinder();
	const commitSideSizes = useCallback(
		(entries: ReadonlyArray<readonly [LayoutSide, number]>) => {
			let next = document;
			const collapsedSides: LayoutSide[] = [];
			for (const [side, size] of entries) {
				if (size <= Number.EPSILON) collapsedSides.push(side);
				else
					next = resizeSideRegion(
						next,
						side,
						restoreWorkbenchRatio(size / 100, workbenchWidth, columnsWidth),
					);
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
		[apply, document, onCommit, workbenchWidth, columnsWidth],
	);
	const outerSettled = useTopologySettled(
		tupleKey(String(leftOwnsBottomCorner), String(rightOwnsBottomCorner)),
	);
	const alignedColumnMinimum = outerSettled
		? Math.min(100, centerMinimumPercent + (leftInAlignedRow ? 8 : 0) + (rightInAlignedRow ? 8 : 0))
		: 0;
	const outerGroupRef = useRef<ImperativePanelGroupHandle>(null);
	useEnforcedLayout(outerGroupRef, outerCurrent, outerSettled);
	const outerResize = useCommittedSizes(
		outerCurrent,
		gestureContext,
		outerGroupRef,
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
	const { onLayout: onOuterLayout } = outerResize;
	const projectOuterLayout = useCallback(
		(sizes: number[]) => {
			const alignedIndex = leftOwnsBottomCorner ? 1 : 0;
			const width = sizes[alignedIndex] ?? alignedWidthCurrent;
			setAlignedProjection((current) =>
				current.topology === outerTopology && Math.abs(current.width - width) < 0.01
					? current
					: { topology: outerTopology, width },
			);
			onOuterLayout(sizes);
		},
		[alignedWidthCurrent, leftOwnsBottomCorner, onOuterLayout, outerTopology],
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
	const alignedWidth = Math.max(Number.EPSILON, projectedAlignedWidth);
	const alignedRowSettled = useTopologySettled(
		tupleKey(String(leftInAlignedRow), String(rightInAlignedRow)),
	);
	const alignedSideMinimum = alignedRowSettled ? Math.min(100, (8 / alignedWidth) * 100) : 0;
	const alignedCenterMinimum = alignedRowSettled
		? Math.min(100, (centerMinimumPercent / alignedWidth) * 100)
		: 0;
	const alignedRowGroupRef = useRef<ImperativePanelGroupHandle>(null);
	useEnforcedLayout(alignedRowGroupRef, alignedRowCurrent, alignedRowSettled, 0.01);
	const alignedRowResize = useCommittedSizes(
		alignedRowCurrent,
		gestureContext,
		alignedRowGroupRef,
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
	const outerLeftResize = bindSideResize("left", outerResize);
	const outerRightResize = bindSideResize("right", outerResize);
	const alignedLeftResize = bindSideResize("left", alignedRowResize);
	const alignedRightResize = bindSideResize("right", alignedRowResize);
	const bottomVisible =
		document.bottom.visible && document.bottom.groups.some((group) => !group.folded);
	const hiddenBottomTargetGroupId = (() => {
		if (!draggingTab) return undefined;
		const panes = document.bottom.groups.filter((group) =>
			canJoinAuxiliaryGroup(group, draggingTab),
		);
		return (
			panes.find((group) => group.id === attention.lastFocusedSideGroupId.bottom)?.id ??
			panes.at(-1)?.id
		);
	})();
	const bottomCurrent = useMemo(() => {
		if (!bottomVisible) return [100];
		const height = Math.min(
			0.9,
			projectWorkbenchRatio(document.bottom.height, workbenchHeight, bottomBodyHeight),
		);
		return [(1 - height) * 100, height * 100];
	}, [bottomVisible, document.bottom.height, workbenchHeight, bottomBodyHeight]);
	const bottomMaximumPercent = Math.min(
		90,
		projectWorkbenchRatio(LAYOUT_LIMITS.maxBottomHeight, workbenchHeight, bottomBodyHeight) * 100,
	);
	const bottomGroupRef = useRef<ImperativePanelGroupHandle>(null);
	useEnforcedLayout(bottomGroupRef, bottomCurrent, null);
	const bottomResize = useCommittedSizes(
		bottomCurrent,
		gestureContext,
		bottomGroupRef,
		(sizes) => {
			const bottomSize = sizes[1] ?? bottomCurrent[1] ?? 30;
			if (bottomSize <= Number.EPSILON) {
				apply(hideBottom(document, attentionRef.current));
				return;
			}
			const next = resizeBottomRegion(
				document,
				restoreWorkbenchRatio(bottomSize / 100, workbenchHeight, bottomBodyHeight),
			);
			if (next !== document) onCommit(next);
		},
		onGestureCanceled,
	);
	const bottomMinimumPercent = Math.min(
		bottomMaximumPercent,
		bottomBodyHeight > 0
			? ((LAYOUT_LIMITS.minBottomBodyHeight + LAYOUT_LIMITS.auxiliaryHeaderHeight) /
					bottomBodyHeight) *
					100
			: 10,
	);
	const focusableGroups = useMemo(() => visibleFocusableGroups(document), [document]);
	const readAttention = useCallback(() => attentionRef.current, []);
	const focusAdjacentGroup = useCallback(
		(delta: -1 | 1, fromGroupId?: string) => {
			const groups = visibleFocusableGroups(documentRef.current);
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
				onDirectTabActivation?.(selected);
				onAttentionChange(selectTab(currentAttention, target.location, selected.id));
				setLocalFocusRequest({
					workspaceId,
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
					workspaceId,
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
				workspaceId,
				key: createLayoutId("focus-group"),
				location: target.location,
			});
		},
		[onAttentionChange, onDirectTabActivation, onUserNavigation, workspaceId],
	);
	const canFocusAdjacentGroup = focusableGroups.length > 1;
	const hideSideRegion = useCallback(
		(region: LayoutAuxiliaryRegion) =>
			apply(
				region === "bottom"
					? hideBottom(documentRef.current, attentionRef.current)
					: hideSide(documentRef.current, region, attentionRef.current),
			),
		[apply],
	);
	const revealMissingTool = useCallback(
		(tool: LayoutToolId) => {
			const result = revealTool(documentRef.current, tool, maxSideGroups, maxBottomGroups);
			if (!isLayoutUnavailable(result)) apply(result);
		},
		[apply, maxBottomGroups, maxSideGroups],
	);
	const shared: SharedGroupProps = {
		workspaceId,
		document,
		readAttention,
		selectionEpochRef: tabSelectionEpoch,
		maxSideGroups,
		maxBottomGroups,
		draggingTab,
		renderTabBody,
		renderTabAdornment,
		renderToolBody,
		onNewTerminal,
		onUserNavigation,
		onGestureCanceled,
		onApply: apply,
		onClose: close,
		onSelectTab: selectTabInGroup,
		onFocusGroup: focusGroup,
		onFocusAdjacentGroup: focusAdjacentGroup,
		onHideSide: hideSideRegion,
		onRevealTool: revealMissingTool,
		onRenameChat,
		canFocusAdjacentGroup,
	};
	const sideStack = (side: LayoutSide) => (
		<SideStack
			side={side}
			attention={attention}
			projectionEpoch={projectionEpoch}
			onCommit={onCommit}
			{...shared}
		/>
	);
	const centerView = (
		<main data-testid="center-tabs" className="h-full min-h-0 min-w-0">
			<CenterNodeView
				node={document.center}
				attention={attention}
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
	const alignedBody = (
		<ResizablePanelGroup
			ref={bottomGroupRef}
			direction="vertical"
			onLayout={bottomResize.onLayout}
			className="min-h-0 min-w-0 flex-1"
		>
			<ResizablePanel
				id="layout-main-row"
				order={1}
				defaultSize={bottomCurrent[0]}
				minSize={100 - bottomMaximumPercent}
			>
				{alignedTopRow}
			</ResizablePanel>
			{bottomVisible ? (
				<>
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
						maxSize={bottomMaximumPercent}
						collapsedSize={0}
						collapsible
					>
						<BottomAlignedRow document={document}>
							<BottomStack
								attention={attention}
								projectionEpoch={projectionEpoch}
								onCommit={onCommit}
								{...shared}
							/>
						</BottomAlignedRow>
					</ResizablePanel>
				</>
			) : null}
		</ResizablePanelGroup>
	);
	const alignedColumn = (
		<div className="flex h-full min-h-0 min-w-0 flex-col">
			<div ref={bottomBodyRef} className="min-h-0 min-w-0 flex-1">
				{alignedBody}
			</div>
			<AuxiliaryRegionRail
				region="bottom"
				shared={shared}
				attention={attention}
				trailing={
					<div className="flex min-w-32 flex-1 self-stretch">
						{!bottomVisible &&
						draggingTab &&
						canPlaceLayoutTab(draggingTab, "bottom") &&
						(hiddenBottomTargetGroupId !== undefined ||
							canCreateAuxiliaryGroup(
								document,
								"bottom",
								draggingTab,
								maxBottomGroups,
								document.bottom.groups.length,
							)) ? (
							<BottomDropZone
								targetGroupId={hiddenBottomTargetGroupId}
								targetIndex={document.bottom.groups.length}
							/>
						) : (
							<div className="flex-1" />
						)}
						{!bottomVisible ? (
							<BottomAlignmentMenu
								alignment={document.bottom.alignment}
								onChange={(alignment) => onCommit(setBottomAlignment(document, alignment))}
								onHide={() => hideSideRegion("bottom")}
							/>
						) : null}
					</div>
				}
			/>
		</div>
	);
	const workbenchColumns = (
		<ResizablePanelGroup
			ref={outerGroupRef}
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
			collisionDetection={workbenchCollisionDetection}
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
				<AuxiliaryRegionRail region="left" shared={shared} attention={attention} />
				<div ref={columnsRef} className="min-h-0 min-w-0 flex-1">
					{workbenchColumns}
				</div>
				<AuxiliaryRegionRail region="right" shared={shared} attention={attention} />
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
