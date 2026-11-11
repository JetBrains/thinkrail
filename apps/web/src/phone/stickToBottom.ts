import { type RefObject, useEffect } from "react";

const SLACK_PX = 24;

/** Whether a scroller is showing its end, within a little slack for sub-pixel rounding. */
export const atEnd = (
	scroller: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
): boolean => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= SLACK_PX;

/**
 * Keeps a scroller on its last line while it is resized (the keyboard rising or falling, the composer growing),
 * as long as it was showing that line; a reader scrolled up stays where they are.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>): void {
	useEffect(() => {
		const scroller = ref.current;
		if (!scroller) return;
		let pinned = atEnd(scroller);
		const onScroll = (): void => {
			pinned = atEnd(scroller);
		};
		const resized = new ResizeObserver(() => {
			if (pinned) scroller.scrollTop = scroller.scrollHeight;
		});
		scroller.addEventListener("scroll", onScroll, { passive: true });
		resized.observe(scroller);
		return () => {
			scroller.removeEventListener("scroll", onScroll);
			resized.disconnect();
		};
	}, [ref]);
}
