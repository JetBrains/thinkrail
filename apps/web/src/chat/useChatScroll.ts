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

interface ScrollContainerProps {
	onPointerDown: PointerEventHandler;
	onPointerUp: PointerEventHandler;
	onWheel: WheelEventHandler;
	onTouchStart: TouchEventHandler;
	onTouchEnd: TouchEventHandler;
}

export interface ChatScroll {
	followOutput: (isAtBottom: boolean) => false | "smooth" | "auto";
	handleAtBottom: (atBottom: boolean) => void;
	showScrollButton: boolean;
	scrollToBottom: () => void;
	containerProps: ScrollContainerProps;
}

export function useChatScroll(virtuosoRef: RefObject<VirtuosoHandle | null>): ChatScroll {
	const atBottom = useRef(true);
	const interacting = useRef(false);
	const pinnedAway = useRef(false);
	const [showScrollButton, setShowScrollButton] = useState(false);

	const followOutput = useCallback(
		(isAtBottom: boolean): false | "smooth" =>
			!pinnedAway.current && isAtBottom ? "smooth" : false,
		[],
	);

	const handleAtBottom = useCallback((next: boolean) => {
		atBottom.current = next;
		if (next) {
			pinnedAway.current = false;
		} else if (interacting.current) {
			pinnedAway.current = true;
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
