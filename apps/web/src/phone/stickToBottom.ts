import { type RefObject, useCallback, useEffect, useRef } from "react";

const SLACK_PX = 24;

/** Whether a scroller is showing its end, within a little slack for sub-pixel rounding. */
export const atEnd = (
	scroller: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
): boolean => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= SLACK_PX;

export interface StickToBottom {
	/** Pins the scroller to its end and goes there, e.g. after the reader sends a message. */
	pin: () => void;
	dispose: () => void;
}

/**
 * Keeps a scroller on its last line while it or its content is resized — the keyboard rising, the composer
 * growing, a new row, a streaming answer — as long as it was showing that line; a reader scrolled up stays put.
 */
export function stickToBottom(
	scroller: HTMLElement,
	Observer: typeof ResizeObserver = ResizeObserver,
): StickToBottom {
	let pinned = atEnd(scroller);
	const follow = (): void => {
		if (pinned) scroller.scrollTop = scroller.scrollHeight;
	};
	const onScroll = (): void => {
		pinned = atEnd(scroller);
	};
	const resized = new Observer(follow);
	scroller.addEventListener("scroll", onScroll, { passive: true });
	resized.observe(scroller);
	if (scroller.firstElementChild) resized.observe(scroller.firstElementChild);
	return {
		pin: () => {
			pinned = true;
			follow();
		},
		dispose: () => {
			scroller.removeEventListener("scroll", onScroll);
			resized.disconnect();
		},
	};
}

/** `stickToBottom` over a screen's scroller; the returned `pin` follows its end again. */
export function useStickToBottom(ref: RefObject<HTMLElement | null>): () => void {
	const stick = useRef<StickToBottom | null>(null);
	useEffect(() => {
		const scroller = ref.current;
		if (!scroller) return;
		const current = stickToBottom(scroller);
		stick.current = current;
		return () => {
			current.dispose();
			stick.current = null;
		};
	}, [ref]);
	return useCallback(() => stick.current?.pin(), []);
}
