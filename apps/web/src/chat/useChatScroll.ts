import {
	type FocusEventHandler,
	type KeyboardEventHandler,
	type PointerEventHandler,
	type RefCallback,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type WheelEventHandler,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import type { ChatMessageOrder, StreamingResponseMovement } from "./chatPreferences";
import {
	createReadingBandController,
	headerHeightScrollTarget,
	initialReadingBandSnapshot,
	markerBottomWithoutHeader,
	type ReadingBandController,
	type ReadingBandLatestEdge,
	type ReadingBandScrollBounds,
	type ReadingBandSnapshot,
} from "./readingBand";
import { type RevealBlock, revealScrollTop } from "./scrollGeometry";

interface ScrollContainerProps {
	onFocusCapture: FocusEventHandler;
	onKeyDown: KeyboardEventHandler;
	onPointerCancel: PointerEventHandler;
	onPointerDown: PointerEventHandler;
	onPointerUp: PointerEventHandler;
	onWheel: WheelEventHandler;
}

interface RowLocation {
	id: string;
	index: number;
}

export interface ChatScroll {
	followOutput: false;
	handleAtBottom: (atBottom: boolean) => void;
	handleAtTop: (atTop: boolean) => void;
	handleContentHeight: () => void;
	handleScrollerRef: (element: HTMLElement | Window | null) => void;
	headerRef: RefCallback<HTMLDivElement>;
	streamEdgeRef: RefCallback<HTMLDivElement>;
	runwayEdgeRef: RefCallback<HTMLDivElement>;
	runwayRef: RefCallback<HTMLDivElement>;
	scrollerElement: HTMLElement | null;
	showScrollButton: boolean;
	scrollButtonLabel: "Follow response" | "Latest" | null;
	scrollToLatest: () => void;
	armImmediateTurn: () => void;
	releaseFollow: () => void;
	revealElement: (
		target: HTMLElement,
		block?: RevealBlock,
		runway?: "preserve" | "release",
	) => void;
	runwayActive: boolean;
	followState: "following" | "detached";
	containerProps: ScrollContainerProps;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
	return (
		target instanceof Element &&
		target.closest("a, button, input, textarea, select, [contenteditable=true], [tabindex]") !==
			null
	);
}

function latestEdge(messageOrder: ChatMessageOrder): ReadingBandLatestEdge {
	return messageOrder === "newest-first" ? "top" : "bottom";
}

function scrollBounds(scroller: HTMLElement): ReadingBandScrollBounds {
	return {
		scrollTop: scroller.scrollTop,
		maxScrollTop: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
	};
}

function boundedScrollTop(scroller: HTMLElement): number {
	const bounds = scrollBounds(scroller);
	return Math.min(bounds.maxScrollTop, Math.max(0, bounds.scrollTop));
}

function reachedLatestEdge(scroller: HTMLElement, edge: ReadingBandLatestEdge): boolean {
	const bounds = scrollBounds(scroller);
	return edge === "top" ? bounds.scrollTop <= 1 : bounds.maxScrollTop - bounds.scrollTop <= 1;
}

export function useChatScroll(
	virtuosoRef: RefObject<VirtuosoHandle | null>,
	isStreaming: boolean,
	messageOrder: ChatMessageOrder,
	latestUserRow: RowLocation | null,
	latestRow: RowLocation | null,
	movement: StreamingResponseMovement,
): ChatScroll {
	const edge = latestEdge(messageOrder);
	const scrollerRef = useRef<HTMLElement | null>(null);
	const headerElementRef = useRef<HTMLDivElement | null>(null);
	const edgeRef = useRef<HTMLDivElement | null>(null);
	const runwayEdgeElementRef = useRef<HTMLDivElement | null>(null);
	const runwayElementRef = useRef<HTMLDivElement | null>(null);
	const runwayHeightRef = useRef(0);
	const measuredHeaderHeight = useRef(0);
	const headerAnchorScrollTop = useRef(0);
	const latestEdgeRef = useRef(edge);
	latestEdgeRef.current = edge;
	const atLatest = useRef(true);
	const interactionStartScrollTop = useRef(0);
	const returnIntentUntil = useRef(0);
	const activePointerId = useRef<number | null>(null);
	const activePointerType = useRef<string | null>(null);
	const touchPointerActive = useRef(false);
	const touchMomentum = useRef(false);
	const touchMovingTowardLatest = useRef<boolean | null>(null);
	const previousTouchScrollTop = useRef(0);
	const touchSettleTimer = useRef<number | null>(null);
	const pendingImmediateTurn = useRef(false);
	const previousUserRowId = useRef(latestUserRow?.id ?? null);
	const previousLatestRowId = useRef(latestRow?.id ?? null);
	const latestRowFrame = useRef<number | null>(null);
	const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(null);
	const [headerElement, setHeaderElement] = useState<HTMLDivElement | null>(null);
	const [streamEdgeElement, setStreamEdgeElement] = useState<HTMLDivElement | null>(null);
	const [runwayEdgeElement, setRunwayEdgeElement] = useState<HTMLDivElement | null>(null);
	const [snapshot, setSnapshot] = useState<ReadingBandSnapshot>(() =>
		initialReadingBandSnapshot(isStreaming),
	);
	const [controller] = useState<ReadingBandController>(() =>
		createReadingBandController(
			{
				readGeometry: () => {
					const scroller = scrollerRef.current;
					if (!scroller) return null;
					const currentEdge = latestEdgeRef.current;
					const edgeElement = edgeRef.current;
					const runwayEdgeElement =
						currentEdge === "top" ? runwayEdgeElementRef.current : edgeElement;
					const viewportTop = scroller.getBoundingClientRect().top;
					const headerHeight =
						currentEdge === "top"
							? (headerElementRef.current?.getBoundingClientRect().height ?? 0)
							: 0;
					return {
						...scrollBounds(scroller),
						viewportHeight: scroller.clientHeight,
						edgeBottom: edgeElement
							? markerBottomWithoutHeader(
									edgeElement.getBoundingClientRect().bottom,
									viewportTop,
									0,
								)
							: null,
						runwayBottom: runwayEdgeElement
							? markerBottomWithoutHeader(
									runwayEdgeElement.getBoundingClientRect().bottom,
									viewportTop,
									headerHeight,
								)
							: null,
					};
				},
				readScrollBounds: () => {
					const scroller = scrollerRef.current;
					return scroller ? scrollBounds(scroller) : null;
				},
				readViewportHeight: () => scrollerRef.current?.clientHeight ?? 0,
				writeScrollTop: (top) => {
					const scroller = scrollerRef.current;
					if (!scroller) return;
					scroller.scrollTop = top;
					const headerHeight = headerElementRef.current?.getBoundingClientRect().height ?? 0;
					if (Math.abs(headerHeight - measuredHeaderHeight.current) <= 0.5) {
						headerAnchorScrollTop.current = boundedScrollTop(scroller);
					}
				},
				writeRunwayHeight: (height) => {
					runwayHeightRef.current = height;
					const runway = runwayElementRef.current;
					if (runway) runway.style.height = `${height}px`;
				},
				anchorTurn: (index, inset) => {
					virtuosoRef.current?.scrollToIndex({
						index,
						align: "start",
						offset: -inset,
						behavior: "auto",
					});
				},
				prefersReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
				now: () => performance.now(),
				requestFrame: (callback) => requestAnimationFrame(callback),
				cancelFrame: (id) => cancelAnimationFrame(id),
				onStateChange: setSnapshot,
			},
			{ streaming: isStreaming, latestEdge: edge, movement },
		),
	);

	const clearReturnIntent = useCallback(() => {
		returnIntentUntil.current = 0;
		activePointerId.current = null;
		activePointerType.current = null;
		touchPointerActive.current = false;
		touchMomentum.current = false;
		touchMovingTowardLatest.current = null;
		if (touchSettleTimer.current !== null) window.clearTimeout(touchSettleTimer.current);
		touchSettleTimer.current = null;
	}, []);

	const settleTouch = useCallback(() => {
		if (touchPointerActive.current) return;
		const scroller = scrollerRef.current;
		if (
			touchMomentum.current &&
			touchMovingTowardLatest.current === true &&
			scroller &&
			reachedLatestEdge(scroller, edge)
		) {
			controller.readerReachedEdge();
		}
		clearReturnIntent();
	}, [clearReturnIntent, controller, edge]);

	const scheduleTouchSettle = useCallback(
		(delay = 250) => {
			if (touchSettleTimer.current !== null) window.clearTimeout(touchSettleTimer.current);
			touchSettleTimer.current = window.setTimeout(settleTouch, delay);
		},
		[settleTouch],
	);

	const readerLeft = useCallback(() => {
		clearReturnIntent();
		controller.readerLeft();
	}, [clearReturnIntent, controller]);

	useLayoutEffect(() => {
		atLatest.current = true;
		clearReturnIntent();
		if (latestRowFrame.current !== null) cancelAnimationFrame(latestRowFrame.current);
		latestRowFrame.current = null;
		controller.setLatestEdge(edge);
		return () => {
			if (latestRowFrame.current !== null) cancelAnimationFrame(latestRowFrame.current);
			latestRowFrame.current = null;
		};
	}, [clearReturnIntent, controller, edge]);

	useLayoutEffect(() => {
		controller.setStreaming(isStreaming);
	}, [controller, isStreaming]);

	useLayoutEffect(() => {
		controller.setMovement(movement);
	}, [controller, movement]);

	useLayoutEffect(() => {
		const row = latestUserRow;
		if (!row || row.id === previousUserRowId.current) return;
		previousUserRowId.current = row.id;
		const source = pendingImmediateTurn.current ? "immediate" : "queued";
		pendingImmediateTurn.current = false;
		if (source === "queued" && !isStreaming) return;
		controller.userTurnArrived(row.index, source);
	}, [controller, isStreaming, latestUserRow]);

	useLayoutEffect(() => {
		const rowId = latestRow?.id ?? null;
		if (rowId === previousLatestRowId.current) return;
		previousLatestRowId.current = rowId;
		if (latestRowFrame.current !== null) cancelAnimationFrame(latestRowFrame.current);
		latestRowFrame.current = null;
		if (!latestRow || edge !== "top" || rowId === latestUserRow?.id) return;
		latestRowFrame.current = requestAnimationFrame(() => {
			latestRowFrame.current = null;
			if (previousLatestRowId.current !== rowId) return;
			controller.latestRowArrived(latestRow.index);
		});
	}, [controller, edge, latestRow, latestUserRow?.id]);

	useLayoutEffect(() => {
		if (!scrollerElement || (!streamEdgeElement && !runwayEdgeElement)) return;
		if (isStreaming) controller.reconstructActiveStream();
		controller.contentChanged();
	}, [controller, isStreaming, runwayEdgeElement, scrollerElement, streamEdgeElement]);

	useLayoutEffect(() => {
		if (!headerElement || edge !== "top") return;
		measuredHeaderHeight.current = headerElement.getBoundingClientRect().height;
		const scrollerAtMount = scrollerRef.current;
		if (scrollerAtMount) headerAnchorScrollTop.current = boundedScrollTop(scrollerAtMount);
		const observer = new ResizeObserver(() => {
			const nextHeight = headerElement.getBoundingClientRect().height;
			const scroller = scrollerRef.current;
			if (scroller) {
				const previousScrollTop = headerAnchorScrollTop.current;
				const target = headerHeightScrollTarget(
					previousScrollTop,
					measuredHeaderHeight.current,
					nextHeight,
					scrollBounds(scroller),
					edge,
					controller.getSnapshot().following,
				);
				scroller.scrollTop = target;
				const actual = boundedScrollTop(scroller);
				interactionStartScrollTop.current += actual - previousScrollTop;
				previousTouchScrollTop.current = actual;
				headerAnchorScrollTop.current = actual;
			}
			measuredHeaderHeight.current = nextHeight;
			controller.contentChanged();
		});
		observer.observe(headerElement);
		return () => observer.disconnect();
	}, [controller, edge, headerElement]);

	useEffect(() => {
		if (!scrollerElement) return;
		const observer = new ResizeObserver(() => controller.contentChanged());
		observer.observe(scrollerElement);
		return () => observer.disconnect();
	}, [controller, scrollerElement]);

	useEffect(() => {
		if (!scrollerElement) return;
		previousTouchScrollTop.current = boundedScrollTop(scrollerElement);
		const onScroll = () => {
			const nextScrollTop = boundedScrollTop(scrollerElement);
			const headerHeight = headerElementRef.current?.getBoundingClientRect().height ?? 0;
			if (Math.abs(headerHeight - measuredHeaderHeight.current) <= 0.5) {
				headerAnchorScrollTop.current = nextScrollTop;
			}
			const delta = nextScrollTop - previousTouchScrollTop.current;
			previousTouchScrollTop.current = nextScrollTop;
			if (!touchMomentum.current || delta === 0) return;
			const movedTowardLatest = edge === "bottom" ? delta > 0 : delta < 0;
			touchMovingTowardLatest.current = movedTowardLatest;
			returnIntentUntil.current = 0;
			if (!movedTowardLatest) controller.readerLeft();
			if (!touchPointerActive.current) scheduleTouchSettle(1_000);
		};
		const onScrollEnd = () => settleTouch();
		scrollerElement.addEventListener("scroll", onScroll, { passive: true });
		scrollerElement.addEventListener("scrollend", onScrollEnd);
		return () => {
			scrollerElement.removeEventListener("scroll", onScroll);
			scrollerElement.removeEventListener("scrollend", onScrollEnd);
		};
	}, [controller, edge, scheduleTouchSettle, scrollerElement, settleTouch]);

	useEffect(() => {
		const onSelectionChange = () => {
			const scroller = scrollerRef.current;
			const selection = document.getSelection();
			if (
				!scroller ||
				!selection ||
				selection.isCollapsed ||
				!selection.anchorNode ||
				!scroller.contains(selection.anchorNode)
			) {
				return;
			}
			readerLeft();
		};
		document.addEventListener("selectionchange", onSelectionChange);
		return () => document.removeEventListener("selectionchange", onSelectionChange);
	}, [readerLeft]);

	useEffect(
		() => () => {
			clearReturnIntent();
			if (latestRowFrame.current !== null) cancelAnimationFrame(latestRowFrame.current);
			latestRowFrame.current = null;
			controller.dispose();
		},
		[clearReturnIntent, controller],
	);

	const handleScrollerRef = useCallback((element: HTMLElement | Window | null) => {
		const next = element instanceof HTMLElement ? element : null;
		scrollerRef.current = next;
		if (next) headerAnchorScrollTop.current = boundedScrollTop(next);
		setScrollerElement(next);
	}, []);

	const headerRef = useCallback<RefCallback<HTMLDivElement>>((element) => {
		headerElementRef.current = element;
		measuredHeaderHeight.current = element?.getBoundingClientRect().height ?? 0;
		const scroller = scrollerRef.current;
		if (scroller) headerAnchorScrollTop.current = boundedScrollTop(scroller);
		setHeaderElement(element);
	}, []);

	const streamEdgeRef = useCallback<RefCallback<HTMLDivElement>>((element) => {
		edgeRef.current = element;
		setStreamEdgeElement(element);
	}, []);

	const runwayEdgeRef = useCallback<RefCallback<HTMLDivElement>>((element) => {
		runwayEdgeElementRef.current = element;
		setRunwayEdgeElement(element);
	}, []);

	const runwayRef = useCallback<RefCallback<HTMLDivElement>>(
		(element) => {
			runwayElementRef.current = element;
			if (!element) return;
			element.style.height = `${runwayHeightRef.current}px`;
			controller.contentChanged();
		},
		[controller],
	);

	const armImmediateTurn = useCallback(() => {
		clearReturnIntent();
		pendingImmediateTurn.current = true;
		controller.armImmediateTurn();
	}, [clearReturnIntent, controller]);

	const revealElement = useCallback(
		(target: HTMLElement, block: RevealBlock = "nearest", runway = "preserve") => {
			const scroller = scrollerRef.current;
			if (!scroller?.contains(target)) return;
			clearReturnIntent();
			controller.cancelMovement();
			if (runway === "release") controller.releaseRunway(false);
			const viewportRect = scroller.getBoundingClientRect();
			const targetRect = target.getBoundingClientRect();
			scroller.scrollTop = revealScrollTop(
				{
					...scrollBounds(scroller),
					viewportTop: viewportRect.top,
					viewportBottom: viewportRect.bottom,
					targetTop: targetRect.top,
					targetBottom: targetRect.bottom,
				},
				block,
			);
		},
		[clearReturnIntent, controller],
	);

	const releaseFollow = readerLeft;
	const scrollToLatest = useCallback(() => {
		clearReturnIntent();
		controller.returnToEdge();
	}, [clearReturnIntent, controller]);
	const handleContentHeight = useCallback(() => controller.contentChanged(), [controller]);

	const handleLatestState = useCallback(
		(next: boolean) => {
			atLatest.current = next;
			if (next && !touchMomentum.current && performance.now() <= returnIntentUntil.current) {
				controller.readerReachedEdge();
				clearReturnIntent();
			}
		},
		[clearReturnIntent, controller],
	);

	const handleAtBottom = useCallback(
		(next: boolean) => {
			if (edge === "bottom") handleLatestState(next);
		},
		[edge, handleLatestState],
	);

	const handleAtTop = useCallback(
		(next: boolean) => {
			if (edge === "top") handleLatestState(next);
		},
		[edge, handleLatestState],
	);

	const onPointerDown = useCallback<PointerEventHandler>(
		(event) => {
			clearReturnIntent();
			const scroller = scrollerRef.current;
			const scrollTop = scroller ? boundedScrollTop(scroller) : 0;
			interactionStartScrollTop.current = scrollTop;
			previousTouchScrollTop.current = scrollTop;
			activePointerId.current = event.pointerId;
			activePointerType.current = event.pointerType;
			touchPointerActive.current = event.pointerType === "touch";
			touchMomentum.current = event.pointerType === "touch";
			touchMovingTowardLatest.current = null;
			controller.readerLeft();
		},
		[clearReturnIntent, controller],
	);

	const finishPointerInteraction = useCallback(
		(pointerType: string, pointerId: number, terminal: "up" | "cancel") => {
			if (activePointerId.current !== pointerId || activePointerType.current !== pointerType) {
				return;
			}
			activePointerId.current = null;
			activePointerType.current = null;
			const scroller = scrollerRef.current;
			const delta = (scroller ? boundedScrollTop(scroller) : 0) - interactionStartScrollTop.current;
			const totalMovedTowardLatest = edge === "bottom" ? delta > 1 : delta < -1;
			if (pointerType === "touch") {
				touchPointerActive.current = false;
				touchMomentum.current = true;
				const movedTowardLatest = touchMovingTowardLatest.current ?? totalMovedTowardLatest;
				touchMovingTowardLatest.current = movedTowardLatest;
				returnIntentUntil.current = 0;
				if (
					terminal === "up" &&
					movedTowardLatest &&
					scroller &&
					reachedLatestEdge(scroller, edge)
				) {
					controller.readerReachedEdge();
					clearReturnIntent();
					return;
				}
				scheduleTouchSettle(terminal === "cancel" ? 1_000 : 500);
				return;
			}
			if (totalMovedTowardLatest) {
				returnIntentUntil.current = performance.now() + 500;
				if (scroller && reachedLatestEdge(scroller, edge)) {
					controller.readerReachedEdge();
					clearReturnIntent();
				}
				return;
			}
			clearReturnIntent();
		},
		[clearReturnIntent, controller, edge, scheduleTouchSettle],
	);

	const onPointerUp = useCallback<PointerEventHandler>(
		(event) => finishPointerInteraction(event.pointerType, event.pointerId, "up"),
		[finishPointerInteraction],
	);

	const onPointerCancel = useCallback<PointerEventHandler>(
		(event) => finishPointerInteraction(event.pointerType, event.pointerId, "cancel"),
		[finishPointerInteraction],
	);

	const onWheel = useCallback<WheelEventHandler>(
		(event) => {
			if (event.deltaY === 0) return;
			if (controller.getSnapshot().following) {
				readerLeft();
				return;
			}
			const movesTowardLatest = edge === "bottom" ? event.deltaY > 0 : event.deltaY < 0;
			if (!movesTowardLatest) {
				readerLeft();
				return;
			}
			returnIntentUntil.current = performance.now() + 500;
			if (atLatest.current) controller.readerReachedEdge();
		},
		[controller, edge, readerLeft],
	);

	const onKeyDown = useCallback<KeyboardEventHandler>(
		(event) => {
			if (
				event.defaultPrevented ||
				(event.target !== scrollerRef.current && isInteractiveTarget(event.target))
			) {
				return;
			}
			const movesTowardTop =
				event.key === "ArrowUp" ||
				event.key === "PageUp" ||
				event.key === "Home" ||
				(event.key === " " && event.shiftKey);
			const movesTowardBottom =
				event.key === "ArrowDown" ||
				event.key === "PageDown" ||
				event.key === "End" ||
				(event.key === " " && !event.shiftKey);
			const movesTowardLatest = edge === "top" ? movesTowardTop : movesTowardBottom;
			const movesTowardHistory = edge === "top" ? movesTowardBottom : movesTowardTop;
			if (controller.getSnapshot().following && (movesTowardLatest || movesTowardHistory)) {
				readerLeft();
				return;
			}
			if (movesTowardHistory) {
				readerLeft();
				return;
			}
			if (!movesTowardLatest) return;
			if ((edge === "top" && event.key === "Home") || (edge === "bottom" && event.key === "End")) {
				event.preventDefault();
				scrollToLatest();
				return;
			}
			returnIntentUntil.current = performance.now() + 500;
			if (atLatest.current) controller.readerReachedEdge();
		},
		[controller, edge, readerLeft, scrollToLatest],
	);

	const onFocusCapture = useCallback<FocusEventHandler>(
		(event) => {
			if (isInteractiveTarget(event.target)) readerLeft();
		},
		[readerLeft],
	);

	return {
		followOutput: false,
		handleAtBottom,
		handleAtTop,
		handleContentHeight,
		handleScrollerRef,
		headerRef,
		streamEdgeRef,
		runwayEdgeRef,
		runwayRef,
		scrollerElement,
		showScrollButton: snapshot.buttonLabel !== null,
		scrollButtonLabel: snapshot.buttonLabel,
		scrollToLatest,
		armImmediateTurn,
		releaseFollow,
		revealElement,
		runwayActive: snapshot.runway,
		followState: snapshot.following ? "following" : "detached",
		containerProps: {
			onFocusCapture,
			onKeyDown,
			onPointerCancel,
			onPointerDown,
			onPointerUp,
			onWheel,
		},
	};
}
