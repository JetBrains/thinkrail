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
import type { FoldAnchorResolver } from "./foldState";
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

type RowRevealResult = "cancelled" | "found" | "missing";

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
	scrollMoving: boolean;
	scrollToLatest: () => void;
	armImmediateTurn: () => void;
	cancelImmediateTurn: (streaming: boolean) => void;
	cancelAutomaticReveal: () => void;
	revealElement: (target: HTMLElement, options: ChatRevealOptions) => void;
	revealRow: (
		rowId: string,
		resolveIndex: () => number,
		align: "start" | "center" | "end",
		onComplete: (result: RowRevealResult) => void,
	) => () => void;
	prepareFoldChange: (resolveTarget: FoldAnchorResolver) => () => void;
	runwayActive: boolean;
	followState: "following" | "detached";
	containerProps: ScrollContainerProps;
}

const NATIVE_SCROLL_INTENT_MS = 500;
const ROW_MATERIALIZATION_FRAMES = 90;
const ROW_ALIGNMENT_STABILITY_FRAMES = 4;

const KEYBOARD_SCROLL_KEYS = new Set([
	" ",
	"ArrowDown",
	"ArrowUp",
	"End",
	"Home",
	"PageDown",
	"PageUp",
]);

function nearestHtmlElement(element: Element | null): HTMLElement | null {
	let current = element;
	while (current && !(current instanceof HTMLElement)) current = current.parentElement;
	return current;
}

function survivesInternalClipping(
	element: HTMLElement,
	scroller: HTMLElement,
	anchorOffset: number,
): boolean {
	if (!element.isConnected) return false;
	const elementRect = element.getBoundingClientRect();
	if (elementRect.height <= 0 || anchorOffset < 0 || anchorOffset > elementRect.height)
		return false;
	const anchor = elementRect.top + anchorOffset;
	let ancestor = element.parentElement;
	while (ancestor && ancestor !== scroller) {
		const { overflowY, visibility } = getComputedStyle(ancestor);
		if (visibility === "hidden") return false;
		if (["auto", "clip", "hidden", "scroll"].includes(overflowY)) {
			const rect = ancestor.getBoundingClientRect();
			if (anchor <= rect.top || anchor >= rect.bottom) return false;
		}
		ancestor = ancestor.parentElement;
	}
	return ancestor === scroller;
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
	firstItemIndex: number,
	rowHeightEstimates: readonly number[],
	movement: StreamingResponseMovement,
): ChatScroll {
	const edge = latestEdge(messageOrder);
	const firstItemIndexRef = useRef(firstItemIndex);
	firstItemIndexRef.current = firstItemIndex;
	const rowHeightEstimatesRef = useRef(rowHeightEstimates);
	rowHeightEstimatesRef.current = rowHeightEstimates;
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
	const pointerIntentUntil = useRef(0);
	const keyboardIntentUntil = useRef(0);
	const wheelIntentUntil = useRef(0);
	const activePointerId = useRef<number | null>(null);
	const activePointerType = useRef<string | null>(null);
	const pointerMayContinueScroll = useRef(false);
	const touchPointerActive = useRef(false);
	const touchMomentum = useRef(false);
	const touchMovingTowardLatest = useRef<boolean | null>(null);
	const previousTouchScrollTop = useRef(0);
	const programmaticScrollTop = useRef<number | null>(null);
	const touchSettleTimer = useRef<number | null>(null);
	const nativeInterruptionGeneration = useRef(0);
	const nativeResume = useRef<(() => void) | null>(null);
	const pendingImmediateTurn = useRef(false);
	const observedLifecycle = useRef({ isStreaming, settlementTick });
	const previousUserRowId = useRef(latestUserRow?.id ?? null);
	const previousLatestRowId = useRef(latestRow?.id ?? null);
	const latestRowFrame = useRef<number | null>(null);
	const rowRevealFrame = useRef<number | null>(null);
	const rowRevealGeneration = useRef(0);
	const rowRevealCompletion = useRef<((result: RowRevealResult) => void) | null>(null);
	const foldResizeObserver = useRef<ResizeObserver | null>(null);
	const foldSurvivorElement = useRef<HTMLElement | null>(null);
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

	const resumeNativeMotion = useCallback(() => {
		const resume = nativeResume.current;
		nativeResume.current = null;
		resume?.();
	}, []);

	const pauseForNativeInput = useCallback(() => {
		resumeNativeMotion();
		const resume = controller.interruptForNativeInput();
		nativeResume.current = resume;
		return resume;
	}, [controller, resumeNativeMotion]);

	const clearReturnIntent = useCallback(() => {
		resumeNativeMotion();
		nativeInterruptionGeneration.current += 1;
		returnIntentUntil.current = 0;
		pointerIntentUntil.current = 0;
		keyboardIntentUntil.current = 0;
		wheelIntentUntil.current = 0;
		activePointerId.current = null;
		activePointerType.current = null;
		pointerMayContinueScroll.current = false;
		touchPointerActive.current = false;
		touchMomentum.current = false;
		touchMovingTowardLatest.current = null;
		if (touchSettleTimer.current !== null) window.clearTimeout(touchSettleTimer.current);
		touchSettleTimer.current = null;
	}, [resumeNativeMotion]);

	const cancelRowReveal = useCallback((notify = true) => {
		rowRevealGeneration.current += 1;
		if (rowRevealFrame.current !== null) cancelAnimationFrame(rowRevealFrame.current);
		rowRevealFrame.current = null;
		const completion = rowRevealCompletion.current;
		rowRevealCompletion.current = null;
		if (notify) completion?.("cancelled");
	}, []);

	const clearFoldResizeObserver = useCallback(() => {
		foldResizeObserver.current?.disconnect();
		foldResizeObserver.current = null;
		foldSurvivorElement.current = null;
	}, []);

	const settleTouch = useCallback(() => {
		if (touchPointerActive.current) return;
		const scroller = scrollerRef.current;
		const returning = touchMomentum.current
			? touchMovingTowardLatest.current === true
			: returnIntentUntil.current > performance.now();
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

	const interruptForNativeInput = useCallback(
		(scroller: HTMLElement) => {
			const generation = nativeInterruptionGeneration.current + 1;
			nativeInterruptionGeneration.current = generation;
			const scrollTopBeforeInput = boundedScrollTop(scroller);
			const resume = pauseForNativeInput();
			requestAnimationFrame(() => {
				if (
					nativeInterruptionGeneration.current !== generation ||
					Math.abs(boundedScrollTop(scroller) - scrollTopBeforeInput) > 1
				)
					return;
				nativeResume.current = null;
				resume();
			});
		},
		[pauseForNativeInput],
	);

	const prepareFoldChange = useCallback(
		(resolveTarget: FoldAnchorResolver) => {
			let afterChange = false;
			const complete = () => {
				afterChange = true;
				controller.refreshAnchor();
			};
			const scroller = scrollerRef.current;
			const target = resolveTarget();
			if (!scroller || !target || !scroller.contains(target)) return complete;
			controller.cancelReveal();
			pointerIntentUntil.current = 0;
			keyboardIntentUntil.current = 0;
			wheelIntentUntil.current = 0;
			returnIntentUntil.current = 0;
			clearFoldResizeObserver();
			if (controller.getSnapshot().following) return complete;
			const changedRow = target.closest<HTMLElement>("[data-chat-row-id]");
			const changedRowId = changedRow?.dataset.chatRowId;
			const changedRowHeight = changedRow?.getBoundingClientRect().height ?? 0;
			const resolveChangedRow = () =>
				changedRowId
					? (Array.from(scroller.querySelectorAll<HTMLElement>("[data-chat-row-id]")).find(
							(row) => row.dataset.chatRowId === changedRowId,
						) ?? null)
					: null;
			if (changedRow) {
				foldResizeObserver.current = new ResizeObserver(() => controller.refreshAnchor());
				foldResizeObserver.current.observe(changedRow);
			}
			const viewport = scroller.getBoundingClientRect();
			const trail = scroller
				.closest<HTMLElement>("[data-testid=chat-scroll]")
				?.querySelector<HTMLElement>("[data-testid=activity-breadcrumb-trail]");
			const unobscuredTop = Math.max(viewport.top, trail?.getBoundingClientRect().bottom ?? 0);
			const targetRect = target.getBoundingClientRect();
			const disclosure = target.closest<HTMLElement>("[data-chat-fold-root]") ?? changedRow;
			const disclosureRect = disclosure?.getBoundingClientRect() ?? targetRect;
			const targetVisible = targetRect.top >= unobscuredTop && targetRect.bottom <= viewport.bottom;
			const disclosureAboveViewport = disclosureRect.bottom <= unobscuredTop;
			const disclosureBelowViewport = disclosureRect.top >= viewport.bottom;
			const initialScrollTop = boundedScrollTop(scroller);
			const initialScrollHeight = scroller.scrollHeight;
			if (targetVisible) {
				const top = targetRect.top;
				controller.stabilizeAnchor(() => {
					if (controller.getSnapshot().following) return null;
					const currentTarget = resolveTarget();
					const bounds = scrollBounds(scroller);
					return currentTarget
						? bounds.scrollTop + currentTarget.getBoundingClientRect().top - top
						: null;
				});
				return complete;
			}
			const centerX = viewport.left + viewport.width / 2;
			const centerY = viewport.top + viewport.height / 2;
			const survivorCandidate = target.ownerDocument.elementFromPoint(centerX, centerY);
			const survivor = scroller.contains(survivorCandidate)
				? nearestHtmlElement(survivorCandidate)
				: null;
			foldSurvivorElement.current = survivor;
			const survivorTop = survivor?.getBoundingClientRect().top ?? 0;
			const survivorOffset = centerY - survivorTop;
			const survivorInsideDisclosure = Boolean(survivor && disclosure?.contains(survivor));
			const visibleRow = survivor?.closest<HTMLElement>("[data-chat-row-id]");
			const visibleRowId = visibleRow?.dataset.chatRowId;
			const visibleRowTop = visibleRow?.getBoundingClientRect().top ?? 0;
			const resolveVisibleRow = () =>
				visibleRowId
					? (Array.from(scroller.querySelectorAll<HTMLElement>("[data-chat-row-id]")).find(
							(row) => row.dataset.chatRowId === visibleRowId,
						) ?? null)
					: null;
			const alignToTop = targetRect.top < unobscuredTop;
			controller.stabilizeAnchor(() => {
				if (controller.getSnapshot().following) return null;
				const bounds = scrollBounds(scroller);
				const currentSurvivor = foldSurvivorElement.current;
				if (
					currentSurvivor &&
					survivesInternalClipping(currentSurvivor, scroller, survivorOffset)
				) {
					return bounds.scrollTop + currentSurvivor.getBoundingClientRect().top - survivorTop;
				}
				if (!survivorInsideDisclosure) {
					const currentVisibleRow = resolveVisibleRow();
					if (currentVisibleRow) {
						return bounds.scrollTop + currentVisibleRow.getBoundingClientRect().top - visibleRowTop;
					}
				}
				if (disclosureAboveViewport) {
					const currentRow = resolveChangedRow();
					const heightDelta = currentRow
						? currentRow.getBoundingClientRect().height - changedRowHeight
						: scroller.scrollHeight - initialScrollHeight;
					return initialScrollTop + heightDelta;
				}
				if (disclosureBelowViewport) return initialScrollTop;
				if (!afterChange) return initialScrollTop;
				const currentTarget = resolveTarget();
				if (!currentTarget) return null;
				const currentRect = currentTarget.getBoundingClientRect();
				const currentViewport = scroller.getBoundingClientRect();
				const currentTrail = scroller
					.closest<HTMLElement>("[data-testid=chat-scroll]")
					?.querySelector<HTMLElement>("[data-testid=activity-breadcrumb-trail]");
				const destination = alignToTop
					? Math.max(currentViewport.top, currentTrail?.getBoundingClientRect().bottom ?? 0)
					: currentViewport.bottom - currentRect.height;
				return bounds.scrollTop + currentRect.top - destination;
			});
			return complete;
		},
		[clearFoldResizeObserver, controller],
	);

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

	useEffect(() => {
		if (!snapshot.moving) clearFoldResizeObserver();
	}, [clearFoldResizeObserver, snapshot.moving]);

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
			const now = performance.now();
			if (returnIntentUntil.current <= now) returnIntentUntil.current = 0;
			if (pointerIntentUntil.current <= now) pointerIntentUntil.current = 0;
			if (keyboardIntentUntil.current <= now) keyboardIntentUntil.current = 0;
			if (wheelIntentUntil.current <= now) wheelIntentUntil.current = 0;
			const pointerMoving =
				(activePointerId.current !== null && pointerMayContinueScroll.current) ||
				pointerIntentUntil.current > now;
			const keyboardMoving = keyboardIntentUntil.current > now;
			const wheelMoving = wheelIntentUntil.current > now;
			const wheelReturning = returnIntentUntil.current > now;
			if (
				!touchMomentum.current &&
				!pointerMoving &&
				!keyboardMoving &&
				!wheelMoving &&
				!wheelReturning
			)
				return;
			const movedTowardLatest = edge === "bottom" ? delta > 0 : delta < 0;
			touchMovingTowardLatest.current = movedTowardLatest;
			nativeResume.current = null;
			cancelRowReveal();
			controller.readerLeft();
			if (!movedTowardLatest) {
				returnIntentUntil.current = 0;
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
			if (activePointerId.current !== null) return;
			if (touchMomentum.current) {
				if (touchMovingTowardLatest.current === true || reachedLatestEdge(scrollerElement, edge)) {
					settleTouch();
				} else {
					scheduleTouchSettle(1_000);
				}
				return;
			}
			if (
				returnIntentUntil.current > performance.now() &&
				reachedLatestEdge(scrollerElement, edge)
			) {
				controller.readerReachedEdge();
			}
			clearReturnIntent();
		};
		scrollerElement.addEventListener("scroll", onScroll, { passive: true });
		scrollerElement.addEventListener("scrollend", onScrollEnd);
		return () => {
			scrollerElement.removeEventListener("scroll", onScroll);
			scrollerElement.removeEventListener("scrollend", onScrollEnd);
		};
	}, [
		cancelRowReveal,
		clearReturnIntent,
		controller,
		edge,
		scheduleTouchSettle,
		scrollerElement,
		settleTouch,
	]);

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
			clearFoldResizeObserver();
			cancelRowReveal(false);
			controller.dispose();
		},
		[cancelRowReveal, clearFoldResizeObserver, clearReturnIntent, controller],
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
		(
			rowId: string,
			resolveIndex: () => number,
			align: "start" | "center" | "end",
			onComplete: (result: RowRevealResult) => void,
		) => {
			cancelRowReveal();
			readerLeft();
			rowRevealCompletion.current = onComplete;
			controller.releaseRunway(false);
			const scroller = scrollerRef.current;
			if (!scroller) {
				rowRevealCompletion.current = null;
				onComplete("missing");
				return () => undefined;
			}
			const generation = rowRevealGeneration.current;
			let attempts = 0;
			let alignedFrames = 0;
			let revealStarted = false;
			const finish = (result: RowRevealResult) => {
				if (generation !== rowRevealGeneration.current) return;
				rowRevealGeneration.current += 1;
				if (rowRevealFrame.current !== null) cancelAnimationFrame(rowRevealFrame.current);
				rowRevealFrame.current = null;
				if (result !== "found") controller.cancelReveal();
				const completion = rowRevealCompletion.current;
				rowRevealCompletion.current = null;
				completion?.(result);
			};
			const startMeasuredReveal = () => {
				revealStarted = true;
				alignedFrames = 0;
				controller.revealTo(() => {
					const current = mountedChatRow(scroller, rowId);
					return current ? rowAlignmentTarget(scroller, current, align) : null;
				}, true);
			};
			const materialize = () => {
				virtuosoRef.current?.getState(({ ranges }) => {
					if (generation !== rowRevealGeneration.current) return;
					const index = resolveIndex();
					if (index < 0) return;
					const viewport = scroller.getBoundingClientRect();
					const anchor = Array.from(
						scroller.querySelectorAll<HTMLElement>("[data-chat-row-index]"),
					).find((row) => Number.isInteger(Number(row.dataset.chatRowIndex)));
					if (!anchor) return;
					const heights = [...rowHeightEstimatesRef.current];
					const currentFirstItemIndex = firstItemIndexRef.current;
					const rangeOffset =
						currentFirstItemIndex > 0 &&
						ranges.some((range) => range.startIndex >= currentFirstItemIndex)
							? currentFirstItemIndex
							: 0;
					for (const range of ranges) {
						const start = Math.max(0, range.startIndex - rangeOffset);
						const end = Math.min(heights.length - 1, range.endIndex - rangeOffset);
						for (let measuredIndex = start; measuredIndex <= end; measuredIndex += 1) {
							heights[measuredIndex] = range.size;
						}
					}
					const anchorIndex = Number(anchor.dataset.chatRowIndex);
					const anchorTop = scroller.scrollTop + anchor.getBoundingClientRect().top - viewport.top;
					const rowTop = estimatedRowTop(heights, anchorIndex, anchorTop, index);
					const target = alignedRowScrollTop(
						rowTop,
						heights[index] ?? 40,
						scroller.clientHeight,
						align,
					);
					scroller.scrollTop = Math.min(scrollBounds(scroller).maxScrollTop, Math.max(0, target));
					recordProgrammaticScrollPosition();
				});
			};
			const waitForAlignedRow = () => {
				if (generation !== rowRevealGeneration.current) return;
				attempts += 1;
				const row = mountedChatRow(scroller, rowId);
				if (!row) {
					revealStarted = false;
					alignedFrames = 0;
					if (attempts === 1 || attempts % 5 === 0) materialize();
				} else if (!revealStarted) {
					startMeasuredReveal();
				} else if (!controller.getSnapshot().moving) {
					const bounds = scrollBounds(scroller);
					const target = Math.min(
						bounds.maxScrollTop,
						Math.max(0, rowAlignmentTarget(scroller, row, align)),
					);
					if (Math.abs(target - bounds.scrollTop) > 1) startMeasuredReveal();
					else alignedFrames += 1;
					if (alignedFrames >= ROW_ALIGNMENT_STABILITY_FRAMES) {
						finish("found");
						return;
					}
				}
				if (attempts >= ROW_MATERIALIZATION_FRAMES) {
					finish("missing");
					return;
				}
				rowRevealFrame.current = requestAnimationFrame(waitForAlignedRow);
			};
			waitForAlignedRow();
			return () => {
				if (generation !== rowRevealGeneration.current) return;
				cancelRowReveal(false);
				controller.cancelReveal();
			};
		},
		[cancelRowReveal, controller, readerLeft, recordProgrammaticScrollPosition, virtuosoRef],
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
			const scroller = scrollerRef.current;
			const scrollTop = scroller ? boundedScrollTop(scroller) : 0;
			interactionStartScrollTop.current = scrollTop;
			previousTouchScrollTop.current = scrollTop;
			activePointerId.current = event.pointerId;
			activePointerType.current = event.pointerType;
			pointerMayContinueScroll.current = event.pointerType !== "touch" && event.target === scroller;
			if (scroller && (event.pointerType === "touch" || event.target === scroller)) {
				pauseForNativeInput();
			}
			touchPointerActive.current = event.pointerType === "touch";
			touchMomentum.current = event.pointerType === "touch";
			touchMovingTowardLatest.current = null;
		},
		[clearReturnIntent, pauseForNativeInput],
	);

	const finishPointerInteraction = useCallback(
		(pointerType: string, pointerId: number, terminal: "up" | "cancel") => {
			if (activePointerId.current !== pointerId || activePointerType.current !== pointerType) {
				return;
			}
			const mayContinueScrolling = pointerMayContinueScroll.current;
			activePointerId.current = null;
			activePointerType.current = null;
			pointerMayContinueScroll.current = false;
			resumeNativeMotion();
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
			const pointerMoved =
				touchMovingTowardLatest.current !== null || (mayContinueScrolling && Math.abs(delta) > 1);
			if (!pointerMoved && !mayContinueScrolling) {
				clearReturnIntent();
				return;
			}
			const movedTowardLatest = touchMovingTowardLatest.current ?? totalMovedTowardLatest;
			const intentUntil = performance.now() + NATIVE_SCROLL_INTENT_MS;
			pointerIntentUntil.current = intentUntil;
			returnIntentUntil.current = movedTowardLatest ? intentUntil : 0;
			if (movedTowardLatest && scroller && reachedLatestEdge(scroller, edge)) {
				controller.readerReachedEdge();
				clearReturnIntent();
				return;
			}
			scheduleTouchSettle(NATIVE_SCROLL_INTENT_MS);
		},
		[clearReturnIntent, controller, edge, resumeNativeMotion, scheduleTouchSettle],
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
			pointerIntentUntil.current = 0;
			keyboardIntentUntil.current = 0;
			programmaticScrollTop.current = null;
			const movesTowardLatest = edge === "bottom" ? event.deltaY > 0 : event.deltaY < 0;
			const intentUntil = performance.now() + 1_000;
			wheelIntentUntil.current = intentUntil;
			returnIntentUntil.current = movesTowardLatest ? intentUntil : 0;
			interruptForNativeInput(scrollerElement);
			scheduleTouchSettle(1_000);
		};
		scrollerElement.addEventListener("wheel", onWheel, { capture: true, passive: false });
		return () => scrollerElement.removeEventListener("wheel", onWheel, { capture: true });
	}, [edge, interruptForNativeInput, scheduleTouchSettle, scrollerElement]);

	const onKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const interactive = event.target !== scrollerRef.current && isInteractiveTarget(event.target);
			if (event.key === "Tab") {
				pointerIntentUntil.current = 0;
				wheelIntentUntil.current = 0;
				returnIntentUntil.current = 0;
				keyboardIntentUntil.current = performance.now() + NATIVE_SCROLL_INTENT_MS;
				const scroller = scrollerRef.current;
				if (scroller) interruptForNativeInput(scroller);
				scheduleTouchSettle(NATIVE_SCROLL_INTENT_MS);
				return;
			}
			if (interactive || !KEYBOARD_SCROLL_KEYS.has(event.key)) return;
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
			pointerIntentUntil.current = 0;
			wheelIntentUntil.current = 0;
			programmaticScrollTop.current = null;
			keyboardIntentUntil.current = performance.now() + NATIVE_SCROLL_INTENT_MS;
			returnIntentUntil.current = movesTowardHistory ? 0 : keyboardIntentUntil.current;
			interruptForNativeInput(scroller);
			scheduleTouchSettle(NATIVE_SCROLL_INTENT_MS);
		},
		[edge, interruptForNativeInput, scheduleTouchSettle, scrollToLatest],
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
		scrollMoving: snapshot.moving,
		scrollToLatest,
		armImmediateTurn,
		cancelImmediateTurn,
		cancelAutomaticReveal,
		revealElement,
		revealRow,
		prepareFoldChange,
		runwayActive: snapshot.runway,
		followState: snapshot.following ? "following" : "detached",
		containerProps: {
			onPointerCancel,
			onPointerDown,
			onPointerUp,
		},
	};
}
