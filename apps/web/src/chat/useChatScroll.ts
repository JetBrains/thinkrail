import {
	type PointerEventHandler,
	type RefCallback,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import type { ChatRevealOptions } from "./ChatActions";
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
import { alignedRowScrollTop, estimatedRowTop, revealScrollTop } from "./scrollGeometry";

interface ScrollContainerProps {
	onPointerCancel: PointerEventHandler;
	onPointerDown: PointerEventHandler;
	onPointerUp: PointerEventHandler;
}

interface RowLocation {
	id: string;
	index: number;
}

export interface ChatScroll {
	followOutput: false;
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
	cancelImmediateTurn: (streaming: boolean) => void;
	cancelAutomaticReveal: () => void;
	revealElement: (target: HTMLElement, options: ChatRevealOptions) => void;
	revealRow: (rowId: string, index: number, align: "start" | "center" | "end") => void;
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

function canScrollBy(scroller: HTMLElement, deltaY: number): boolean {
	const bounds = scrollBounds(scroller);
	if (deltaY < 0) return bounds.scrollTop > 1;
	if (deltaY > 0) return bounds.maxScrollTop - bounds.scrollTop > 1;
	return false;
}

function mountedChatRow(scroller: HTMLElement, rowId: string): HTMLElement | null {
	return (
		Array.from(scroller.querySelectorAll<HTMLElement>("[data-chat-row-id]")).find(
			(row) => row.dataset.chatRowId === rowId,
		) ?? null
	);
}

function rowAlignmentTarget(
	scroller: HTMLElement,
	row: HTMLElement,
	align: "start" | "center" | "end",
): number {
	const viewport = scroller.getBoundingClientRect();
	const target = row.getBoundingClientRect();
	if (align === "start") return scroller.scrollTop + target.top - viewport.top;
	if (align === "end") return scroller.scrollTop + target.bottom - viewport.bottom;
	return scroller.scrollTop + (target.top + target.bottom - viewport.top - viewport.bottom) / 2;
}

export function useChatScroll(
	virtuosoRef: RefObject<VirtuosoHandle | null>,
	isStreaming: boolean,
	settlementTick: number,
	messageOrder: ChatMessageOrder,
	latestUserRow: RowLocation | null,
	latestRow: RowLocation | null,
	rowHeightEstimates: readonly number[],
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
	const interactionStartScrollTop = useRef(0);
	const returnIntentUntil = useRef(0);
	const activePointerId = useRef<number | null>(null);
	const activePointerType = useRef<string | null>(null);
	const touchPointerActive = useRef(false);
	const touchMomentum = useRef(false);
	const touchMovingTowardLatest = useRef<boolean | null>(null);
	const previousTouchScrollTop = useRef(0);
	const programmaticScrollTop = useRef<number | null>(null);
	const touchSettleTimer = useRef<number | null>(null);
	const pendingImmediateTurn = useRef(false);
	const observedLifecycle = useRef({ isStreaming, settlementTick });
	const previousUserRowId = useRef(latestUserRow?.id ?? null);
	const previousLatestRowId = useRef(latestRow?.id ?? null);
	const latestRowFrame = useRef<number | null>(null);
	const rowRevealFrame = useRef<number | null>(null);
	const rowRevealGeneration = useRef(0);
	const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(null);
	const [headerElement, setHeaderElement] = useState<HTMLDivElement | null>(null);
	const [streamEdgeElement, setStreamEdgeElement] = useState<HTMLDivElement | null>(null);
	const [runwayEdgeElement, setRunwayEdgeElement] = useState<HTMLDivElement | null>(null);
	const recordProgrammaticScrollPosition = useCallback(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		const actual = boundedScrollTop(scroller);
		programmaticScrollTop.current = actual;
		previousTouchScrollTop.current = actual;
		headerAnchorScrollTop.current = actual;
	}, []);
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
					recordProgrammaticScrollPosition();
					const headerHeight = headerElementRef.current?.getBoundingClientRect().height ?? 0;
					if (Math.abs(headerHeight - measuredHeaderHeight.current) <= 0.5) {
						headerAnchorScrollTop.current = boundedScrollTop(scroller);
					}
				},
				writeRunwayHeight: (height) => {
					runwayHeightRef.current = height;
					const runway = runwayElementRef.current;
					if (runway) {
						runway.style.height = `${height}px`;
						recordProgrammaticScrollPosition();
					}
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

	const cancelRowReveal = useCallback(() => {
		rowRevealGeneration.current += 1;
		if (rowRevealFrame.current !== null) cancelAnimationFrame(rowRevealFrame.current);
		rowRevealFrame.current = null;
	}, []);

	const settleTouch = useCallback(() => {
		if (touchPointerActive.current) return;
		const scroller = scrollerRef.current;
		const returning = touchMomentum.current
			? touchMovingTowardLatest.current === true
			: returnIntentUntil.current > 0;
		if (returning && scroller && reachedLatestEdge(scroller, edge)) {
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
		programmaticScrollTop.current = null;
		cancelRowReveal();
		controller.readerLeft();
	}, [cancelRowReveal, clearReturnIntent, controller]);

	useLayoutEffect(() => {
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
		const previous = observedLifecycle.current;
		observedLifecycle.current = { isStreaming, settlementTick };
		if (settlementTick !== previous.settlementTick) {
			pendingImmediateTurn.current = false;
			cancelRowReveal();
			controller.settle();
			if (isStreaming) controller.setStreaming(true);
			return;
		}
		if (isStreaming !== previous.isStreaming) controller.setStreaming(isStreaming);
	}, [cancelRowReveal, controller, isStreaming, settlementTick]);

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
		if (!isStreaming || !latestRow || edge !== "top" || rowId === latestUserRow?.id) {
			return;
		}
		latestRowFrame.current = requestAnimationFrame(() => {
			latestRowFrame.current = null;
			if (previousLatestRowId.current !== rowId) return;
			controller.latestRowArrived(latestRow.index);
		});
	}, [controller, edge, isStreaming, latestRow, latestUserRow?.id]);

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
				recordProgrammaticScrollPosition();
				interactionStartScrollTop.current += actual - previousScrollTop;
			}
			measuredHeaderHeight.current = nextHeight;
			controller.contentChanged();
		});
		observer.observe(headerElement);
		return () => observer.disconnect();
	}, [controller, edge, headerElement, recordProgrammaticScrollPosition]);

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
			const expectedProgrammaticScrollTop = programmaticScrollTop.current;
			if (
				expectedProgrammaticScrollTop !== null &&
				Math.abs(nextScrollTop - expectedProgrammaticScrollTop) <= 1
			) {
				programmaticScrollTop.current = null;
				return;
			}
			programmaticScrollTop.current = null;
			if (delta === 0) return;
			const pointerMoving = activePointerId.current !== null;
			const wheelReturning = returnIntentUntil.current > 0;
			if (!touchMomentum.current && !pointerMoving && !wheelReturning) return;
			const movedTowardLatest = edge === "bottom" ? delta > 0 : delta < 0;
			touchMovingTowardLatest.current = movedTowardLatest;
			if (!isStreaming && movedTowardLatest && controller.getSnapshot().following) {
				controller.readerMovedWhileFollowing();
				return;
			}
			if (controller.getSnapshot().following) controller.readerLeft();
			if (!movedTowardLatest) {
				returnIntentUntil.current = 0;
				controller.readerLeft();
				return;
			}
			if (reachedLatestEdge(scrollerElement, edge)) {
				controller.readerReachedEdge();
				returnIntentUntil.current = 0;
				if (activePointerId.current === null && !touchMomentum.current) clearReturnIntent();
				return;
			}
			if (touchMomentum.current && !touchPointerActive.current) scheduleTouchSettle(1_000);
		};
		const onScrollEnd = () => {
			if (touchMomentum.current) {
				settleTouch();
				return;
			}
			if (returnIntentUntil.current > 0 && reachedLatestEdge(scrollerElement, edge)) {
				controller.readerReachedEdge();
				clearReturnIntent();
			}
		};
		scrollerElement.addEventListener("scroll", onScroll, { passive: true });
		scrollerElement.addEventListener("scrollend", onScrollEnd);
		return () => {
			scrollerElement.removeEventListener("scroll", onScroll);
			scrollerElement.removeEventListener("scrollend", onScrollEnd);
		};
	}, [controller, edge, isStreaming, scheduleTouchSettle, scrollerElement, settleTouch]);

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
			cancelRowReveal();
			controller.dispose();
		},
		[cancelRowReveal, clearReturnIntent, controller],
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
			recordProgrammaticScrollPosition();
			controller.contentChanged();
		},
		[controller, recordProgrammaticScrollPosition],
	);

	const armImmediateTurn = useCallback(() => {
		clearReturnIntent();
		cancelRowReveal();
		pendingImmediateTurn.current = true;
		controller.armImmediateTurn();
	}, [cancelRowReveal, clearReturnIntent, controller]);

	const cancelImmediateTurn = useCallback(
		(streaming: boolean) => {
			pendingImmediateTurn.current = false;
			controller.cancelImmediateTurn(streaming);
		},
		[controller],
	);

	const cancelAutomaticReveal = useCallback(() => controller.cancelReveal(), [controller]);

	const revealElement = useCallback(
		(target: HTMLElement, options: ChatRevealOptions) => {
			const scroller = scrollerRef.current;
			if (!scroller?.contains(target)) return;
			cancelRowReveal();
			if (options.provenance === "user-navigation") readerLeft();
			else clearReturnIntent();
			if (options.runway === "release") controller.releaseRunway(false);
			controller.revealTo(() => {
				if (!scroller.contains(target)) return null;
				const viewportRect = scroller.getBoundingClientRect();
				const targetRect = target.getBoundingClientRect();
				return revealScrollTop(
					{
						...scrollBounds(scroller),
						viewportTop: viewportRect.top,
						viewportBottom: viewportRect.bottom,
						topInset: options.topInset ?? 0,
						targetTop: targetRect.top,
						targetBottom: targetRect.bottom,
					},
					options.block,
				);
			}, options.stability === "bounded");
		},
		[cancelRowReveal, clearReturnIntent, controller, readerLeft],
	);

	const revealRow = useCallback(
		(rowId: string, index: number, align: "start" | "center" | "end") => {
			readerLeft();
			controller.releaseRunway(false);
			const scroller = scrollerRef.current;
			if (!scroller) return;
			const generation = rowRevealGeneration.current;
			const revealMountedRow = () => {
				if (generation !== rowRevealGeneration.current) return true;
				const row = mountedChatRow(scroller, rowId);
				if (!row) return false;
				rowRevealFrame.current = null;
				controller.revealTo(() => {
					const current = mountedChatRow(scroller, rowId);
					return current ? rowAlignmentTarget(scroller, current, align) : null;
				}, true);
				return true;
			};
			if (revealMountedRow()) return;
			const viewport = scroller.getBoundingClientRect();
			const anchor = Array.from(
				scroller.querySelectorAll<HTMLElement>("[data-chat-row-index]"),
			).find((row) => Number.isInteger(Number(row.dataset.chatRowIndex)));
			const anchorIndex = anchor ? Number(anchor.dataset.chatRowIndex) : 0;
			const anchorTop = anchor
				? scroller.scrollTop + anchor.getBoundingClientRect().top - viewport.top
				: (headerElementRef.current?.getBoundingClientRect().height ?? 0);
			const rowTop = estimatedRowTop(rowHeightEstimates, anchorIndex, anchorTop, index);
			const target = alignedRowScrollTop(
				rowTop,
				rowHeightEstimates[index] ?? 40,
				scroller.clientHeight,
				align,
			);
			scroller.scrollTop = Math.min(scrollBounds(scroller).maxScrollTop, Math.max(0, target));
			recordProgrammaticScrollPosition();
			let attempts = 0;
			const waitForRow = () => {
				if (revealMountedRow()) return;
				attempts += 1;
				if (attempts >= 30) {
					cancelRowReveal();
					return;
				}
				rowRevealFrame.current = requestAnimationFrame(waitForRow);
			};
			rowRevealFrame.current = requestAnimationFrame(waitForRow);
		},
		[cancelRowReveal, controller, readerLeft, recordProgrammaticScrollPosition, rowHeightEstimates],
	);

	const scrollToLatest = useCallback(() => {
		clearReturnIntent();
		cancelRowReveal();
		controller.returnToEdge();
	}, [cancelRowReveal, clearReturnIntent, controller]);
	const handleContentHeight = useCallback(() => controller.contentChanged(), [controller]);

	const onPointerDown = useCallback<PointerEventHandler>(
		(event) => {
			clearReturnIntent();
			programmaticScrollTop.current = null;
			cancelRowReveal();
			controller.cancelReveal();
			const scroller = scrollerRef.current;
			const scrollTop = scroller ? boundedScrollTop(scroller) : 0;
			interactionStartScrollTop.current = scrollTop;
			previousTouchScrollTop.current = scrollTop;
			activePointerId.current = event.pointerId;
			activePointerType.current = event.pointerType;
			touchPointerActive.current = event.pointerType === "touch";
			touchMomentum.current = event.pointerType === "touch";
			touchMovingTowardLatest.current = null;
		},
		[cancelRowReveal, clearReturnIntent, controller],
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
			const movedTowardLatest = touchMovingTowardLatest.current ?? totalMovedTowardLatest;
			if (movedTowardLatest) {
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

	useEffect(() => {
		if (!scrollerElement) return;
		const onWheel = (event: WheelEvent) => {
			if (event.deltaY === 0 || !canScrollBy(scrollerElement, event.deltaY)) return;
			programmaticScrollTop.current = null;
			cancelRowReveal();
			const movesTowardLatest = edge === "bottom" ? event.deltaY > 0 : event.deltaY < 0;
			if (!isStreaming && movesTowardLatest && controller.getSnapshot().following) {
				controller.readerMovedWhileFollowing();
				return;
			}
			controller.readerLeft();
			if (!movesTowardLatest) {
				returnIntentUntil.current = 0;
				return;
			}
			returnIntentUntil.current = performance.now() + 1_000;
			scheduleTouchSettle(1_000);
		};
		scrollerElement.addEventListener("wheel", onWheel, { capture: true, passive: false });
		return () => scrollerElement.removeEventListener("wheel", onWheel, { capture: true });
	}, [cancelRowReveal, controller, edge, isStreaming, scheduleTouchSettle, scrollerElement]);

	const onKeyDown = useCallback(
		(event: KeyboardEvent) => {
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
			if (!movesTowardLatest && !movesTowardHistory) return;
			if (
				movesTowardLatest &&
				((edge === "top" && event.key === "Home") || (edge === "bottom" && event.key === "End"))
			) {
				event.preventDefault();
				scrollToLatest();
				return;
			}
			const scroller = scrollerRef.current;
			const deltaY = movesTowardTop ? -1 : 1;
			if (!scroller || !canScrollBy(scroller, deltaY)) return;
			programmaticScrollTop.current = null;
			cancelRowReveal();
			if (!isStreaming && movesTowardLatest && controller.getSnapshot().following) {
				controller.readerMovedWhileFollowing();
				return;
			}
			controller.readerLeft();
			if (movesTowardHistory) {
				returnIntentUntil.current = 0;
				return;
			}
			returnIntentUntil.current = performance.now() + 1_000;
			scheduleTouchSettle(1_000);
		},
		[cancelRowReveal, controller, edge, isStreaming, scheduleTouchSettle, scrollToLatest],
	);

	useEffect(() => {
		if (!scrollerElement) return;
		scrollerElement.addEventListener("keydown", onKeyDown);
		return () => scrollerElement.removeEventListener("keydown", onKeyDown);
	}, [onKeyDown, scrollerElement]);

	return {
		followOutput: false,
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
		cancelImmediateTurn,
		cancelAutomaticReveal,
		revealElement,
		revealRow,
		runwayActive: snapshot.runway,
		followState: snapshot.following ? "following" : "detached",
		containerProps: {
			onPointerCancel,
			onPointerDown,
			onPointerUp,
		},
	};
}
