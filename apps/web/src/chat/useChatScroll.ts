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
import {
	createReadingBandController,
	initialReadingBandSnapshot,
	type ReadingBandController,
	type ReadingBandSnapshot,
} from "./readingBand";

interface ScrollContainerProps {
	onFocusCapture: FocusEventHandler;
	onKeyDown: KeyboardEventHandler;
	onPointerCancel: PointerEventHandler;
	onPointerDown: PointerEventHandler;
	onPointerUp: PointerEventHandler;
	onWheel: WheelEventHandler;
}

interface UserRowLocation {
	id: string;
	index: number;
}

export interface ChatScroll {
	followOutput: false;
	handleAtBottom: (atBottom: boolean) => void;
	handleContentHeight: () => void;
	handleScrollerRef: (element: HTMLElement | Window | null) => void;
	streamEdgeRef: RefCallback<HTMLDivElement>;
	runwayRef: RefCallback<HTMLDivElement>;
	scrollerElement: HTMLElement | null;
	showScrollButton: boolean;
	scrollButtonLabel: "Follow response" | "Latest" | null;
	scrollToBottom: () => void;
	armImmediateTurn: () => void;
	releaseFollow: () => void;
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

export function useChatScroll(
	virtuosoRef: RefObject<VirtuosoHandle | null>,
	isStreaming: boolean,
	latestUserRow: UserRowLocation | null,
): ChatScroll {
	const scrollerRef = useRef<HTMLElement | null>(null);
	const edgeRef = useRef<HTMLDivElement | null>(null);
	const runwayElementRef = useRef<HTMLDivElement | null>(null);
	const atBottom = useRef(true);
	const interacting = useRef(false);
	const interactionStartScrollTop = useRef(0);
	const returnIntentUntil = useRef(0);
	const pendingImmediateTurn = useRef(false);
	const previousUserRowId = useRef(latestUserRow?.id ?? null);
	const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(null);
	const [streamEdgeElement, setStreamEdgeElement] = useState<HTMLDivElement | null>(null);
	const [snapshot, setSnapshot] = useState<ReadingBandSnapshot>(() =>
		initialReadingBandSnapshot(isStreaming),
	);
	const [controller] = useState<ReadingBandController>(() =>
		createReadingBandController(
			{
				readGeometry: () => {
					const scroller = scrollerRef.current;
					const edge = edgeRef.current;
					if (!scroller || !edge) return null;
					const viewport = scroller.getBoundingClientRect();
					const marker = edge.getBoundingClientRect();
					return {
						viewportHeight: scroller.clientHeight,
						scrollTop: scroller.scrollTop,
						maxScrollTop: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
						edgeBottom: marker.bottom - viewport.top,
					};
				},
				writeScrollTop: (top) => {
					const scroller = scrollerRef.current;
					if (scroller) scroller.scrollTop = top;
				},
				writeRunwayHeight: (height) => {
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
			{ streaming: isStreaming },
		),
	);

	useLayoutEffect(() => {
		controller.setStreaming(isStreaming);
	}, [controller, isStreaming]);

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
		if (!scrollerElement || !streamEdgeElement || !isStreaming) return;
		controller.reconstructActiveStream();
	}, [controller, isStreaming, scrollerElement, streamEdgeElement]);

	useEffect(() => {
		if (!scrollerElement) return;
		const observer = new ResizeObserver(() => controller.contentChanged());
		observer.observe(scrollerElement);
		return () => observer.disconnect();
	}, [controller, scrollerElement]);

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
			controller.readerLeft();
		};
		document.addEventListener("selectionchange", onSelectionChange);
		return () => document.removeEventListener("selectionchange", onSelectionChange);
	}, [controller]);

	useEffect(() => () => controller.dispose(), [controller]);

	const handleScrollerRef = useCallback((element: HTMLElement | Window | null) => {
		const next = element instanceof HTMLElement ? element : null;
		scrollerRef.current = next;
		setScrollerElement(next);
	}, []);

	const streamEdgeRef = useCallback<RefCallback<HTMLDivElement>>((element) => {
		edgeRef.current = element;
		setStreamEdgeElement(element);
	}, []);

	const runwayRef = useCallback<RefCallback<HTMLDivElement>>((element) => {
		runwayElementRef.current = element;
	}, []);

	const armImmediateTurn = useCallback(() => {
		pendingImmediateTurn.current = true;
		controller.armImmediateTurn();
	}, [controller]);

	const releaseFollow = useCallback(() => controller.readerLeft(), [controller]);
	const scrollToBottom = useCallback(() => controller.returnToEdge(), [controller]);
	const handleContentHeight = useCallback(() => controller.contentChanged(), [controller]);

	const handleAtBottom = useCallback(
		(next: boolean) => {
			atBottom.current = next;
			if (next && performance.now() <= returnIntentUntil.current) {
				controller.readerReachedEdge();
			}
		},
		[controller],
	);

	const onPointerDown = useCallback<PointerEventHandler>(() => {
		interacting.current = true;
		interactionStartScrollTop.current = scrollerRef.current?.scrollTop ?? 0;
		controller.readerLeft();
	}, [controller]);

	const onPointerUp = useCallback<PointerEventHandler>(() => {
		interacting.current = false;
		const movedTowardEnd =
			(scrollerRef.current?.scrollTop ?? 0) > interactionStartScrollTop.current + 1;
		if (movedTowardEnd && atBottom.current) controller.readerReachedEdge();
	}, [controller]);

	const onPointerCancel = useCallback<PointerEventHandler>(() => {
		interacting.current = false;
	}, []);

	const onWheel = useCallback<WheelEventHandler>(
		(event) => {
			if (event.deltaY < 0) {
				controller.readerLeft();
				return;
			}
			if (event.deltaY > 0) {
				returnIntentUntil.current = performance.now() + 500;
				if (atBottom.current) controller.readerReachedEdge();
			}
		},
		[controller],
	);

	const onKeyDown = useCallback<KeyboardEventHandler>(
		(event) => {
			const movesTowardStart =
				event.key === "ArrowUp" ||
				event.key === "PageUp" ||
				event.key === "Home" ||
				(event.key === " " && event.shiftKey);
			if (movesTowardStart) {
				controller.readerLeft();
				return;
			}
			const movesTowardEnd =
				event.key === "ArrowDown" ||
				event.key === "PageDown" ||
				event.key === "End" ||
				(event.key === " " && !event.shiftKey);
			if (!movesTowardEnd) return;
			returnIntentUntil.current = performance.now() + 500;
			if (atBottom.current) controller.readerReachedEdge();
		},
		[controller],
	);

	const onFocusCapture = useCallback<FocusEventHandler>(
		(event) => {
			if (isInteractiveTarget(event.target)) controller.readerLeft();
		},
		[controller],
	);

	return {
		followOutput: false,
		handleAtBottom,
		handleContentHeight,
		handleScrollerRef,
		streamEdgeRef,
		runwayRef,
		scrollerElement,
		showScrollButton: snapshot.buttonLabel !== null,
		scrollButtonLabel: snapshot.buttonLabel,
		scrollToBottom,
		armImmediateTurn,
		releaseFollow,
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
