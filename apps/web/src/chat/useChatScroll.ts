import {
	type PointerEventHandler,
	type RefObject,
	type TouchEventHandler,
	useCallback,
	useRef,
	useState,
	type WheelEventHandler,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";

/** Container event handlers that detect deliberate user scrolling; spread onto the list's wrapper. */
interface ScrollContainerProps {
	onPointerDown: PointerEventHandler;
	onPointerUp: PointerEventHandler;
	onWheel: WheelEventHandler;
	onTouchStart: TouchEventHandler;
	onTouchEnd: TouchEventHandler;
}

export interface ChatScroll {
	/** Virtuoso `followOutput`: follow new content only while the user hasn't scrolled away. */
	followOutput: (isAtBottom: boolean) => false | "smooth" | "auto";
	/** Virtuoso `atBottomStateChange` handler. */
	handleAtBottom: (atBottom: boolean) => void;
	/** Whether to show the floating "jump to latest" button. */
	showScrollButton: boolean;
	/** Smooth-scroll to the latest message and re-enable auto-follow. */
	scrollToBottom: () => void;
	containerProps: ScrollContainerProps;
}

/**
 * Pointer-aware auto-scroll for the chat list. While the user sits at the bottom, streamed content
 * auto-follows; once they scroll up on purpose (wheel-up, scrollbar drag, touch swipe), following is
 * suppressed until they return to the bottom or click the jump button. Self-contained — no store/transport.
 */
export function useChatScroll(virtuosoRef: RefObject<VirtuosoHandle | null>): ChatScroll {
	// Refs (not state) so the event callbacks always read the latest value without re-subscribing.
	const atBottom = useRef(true);
	const interacting = useRef(false);
	/** `true` once the user intentionally scrolled away from the bottom; cleared when they return. */
	const pinnedAway = useRef(false);
	const [showScrollButton, setShowScrollButton] = useState(false);

	// Virtuoso calls this when new content arrives, passing whether the list was at the bottom. Follow only
	// while the user hasn't scrolled away, so streaming tokens never yank a user reading earlier text.
	const followOutput = useCallback(
		(isAtBottom: boolean): false | "smooth" =>
			!pinnedAway.current && isAtBottom ? "smooth" : false,
		[],
	);

	const handleAtBottom = useCallback((next: boolean) => {
		atBottom.current = next;
		if (next) {
			pinnedAway.current = false; // back at the bottom → re-enable auto-follow
		} else if (interacting.current) {
			pinnedAway.current = true; // left the bottom during a deliberate gesture
		}
		setShowScrollButton(!next);
	}, []);

	const scrollToBottom = useCallback(() => {
		pinnedAway.current = false;
		virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "smooth" });
	}, [virtuosoRef]);

	const onInteractStart = useCallback(() => {
		interacting.current = true;
	}, []);

	const onInteractEnd = useCallback(() => {
		interacting.current = false;
		if (!atBottom.current) pinnedAway.current = true;
	}, []);

	// Wheel has no down/up bracket: a single upward tick is itself the "reading back" signal.
	const onWheel = useCallback<WheelEventHandler>((e) => {
		if (e.deltaY < 0) pinnedAway.current = true;
	}, []);

	const containerProps: ScrollContainerProps = {
		onPointerDown: onInteractStart,
		onPointerUp: onInteractEnd,
		onWheel,
		onTouchStart: onInteractStart,
		onTouchEnd: onInteractEnd,
	};

	return { followOutput, handleAtBottom, showScrollButton, scrollToBottom, containerProps };
}
