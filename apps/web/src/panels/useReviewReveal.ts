import type { GitFileChange, GitStatus } from "@thinkrail/contracts";
import {
	type MutableRefObject,
	type RefObject,
	useCallback,
	useEffect,
	useInsertionEffect,
	useRef,
	useState,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { type ChangesLayout, type ChangesTabReveal, useAppStore } from "../store";

const SECTION_HEADER_HEIGHT = 32;
const END_NOTE_HEIGHT = 48;
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

// The section a programmatic scroll is settling onto; `commentId` is best-effort centering for a card
// already in the DOM (small sections) — bounded sections reveal via Pierre focus instead.
type SettleTarget = { path: string; commentId?: string };

interface ReviewRevealInput {
	workspaceId: string;
	tabId: string;
	files: readonly GitFileChange[];
	status: GitStatus | null;
	layout: ChangesLayout;
	reveal: ChangesTabReveal | null;
	activePath: string | null;
	// Shared with the data-read hook's onSwitch, so it lives in the component and is passed in.
	restoredStacked: MutableRefObject<boolean>;
}

interface ReviewReveal {
	virtuoso: RefObject<VirtuosoHandle | null>;
	attachScroller: (element: HTMLElement | Window | null) => void;
	tailHeight: number;
	spyActiveSection: () => void;
	onTotalListHeightChanged: () => void;
}

// Owns the continuous-review scroll choreography: which section is "active" as the list scrolls, the
// settle-to-a-revealed-section dance while Virtuoso measures variable section heights, and the tail
// spacer height. The within-section reveal of a comment is NOT done here — `consumeChangesTabReveal`
// raises a `reviewFocusRequest` that the target section's `usePierreFocus` consumes (`revealLine`), the
// only path that can surface a line not yet rendered in a bounded, virtualized section.
export function useReviewReveal({
	workspaceId,
	tabId,
	files,
	status,
	layout,
	reveal,
	activePath,
	restoredStacked,
}: ReviewRevealInput): ReviewReveal {
	const setActivePath = useAppStore((state) => state.setChangesTabActivePath);
	const consumeReveal = useAppStore((state) => state.consumeChangesTabReveal);

	const virtuoso = useRef<VirtuosoHandle>(null);
	const scrollerRef = useRef<HTMLElement | null>(null);
	const [tailHeight, setTailHeight] = useState(0);
	const tailObserver = useRef<ResizeObserver | null>(null);
	const settling = useRef<SettleTarget | null>(null);
	const releaseSettling = useCallback(() => {
		const commentId = settling.current?.commentId;
		settling.current = null;
		if (commentId) useAppStore.getState().clearReviewFocus(commentId);
	}, []);
	const detachScroller = useRef<(() => void) | null>(null);
	const attachScroller = useCallback(
		(element: HTMLElement | Window | null) => {
			detachScroller.current?.();
			detachScroller.current = null;
			tailObserver.current?.disconnect();
			tailObserver.current = null;
			const scroller = element instanceof HTMLElement ? element : null;
			scrollerRef.current = scroller;
			if (!scroller) return;
			const measure = () => {
				setTailHeight(Math.max(0, scroller.clientHeight - SECTION_HEADER_HEIGHT - END_NOTE_HEIGHT));
			};
			measure();
			tailObserver.current = new ResizeObserver(measure);
			tailObserver.current.observe(scroller);
			for (const type of USER_SCROLL_EVENTS)
				scroller.addEventListener(type, releaseSettling, { passive: true, capture: true });
			detachScroller.current = () => {
				for (const type of USER_SCROLL_EVENTS)
					scroller.removeEventListener(type, releaseSettling, true);
			};
		},
		[releaseSettling],
	);
	useEffect(
		() => () => {
			tailObserver.current?.disconnect();
			detachScroller.current?.();
			releaseSettling();
		},
		[releaseSettling],
	);
	const activePathRef = useRef(activePath);
	useInsertionEffect(() => {
		activePathRef.current = activePath;
	});
	const spyFrame = useRef(0);
	const scrollToSection = useCallback(
		(index: number, target: SettleTarget) => {
			releaseSettling();
			settling.current = target;
			virtuoso.current?.scrollToIndex({ index, align: "start" });
		},
		[releaseSettling],
	);
	const revealComment = useCallback(() => {
		const commentId = settling.current?.commentId;
		const scroller = scrollerRef.current;
		if (!commentId || !scroller) return false;
		const card = [...scroller.querySelectorAll<HTMLElement>("[data-comment-id]")].find(
			(element) => element.dataset.commentId === commentId,
		);
		if (!card) return false;
		card.scrollIntoView({ block: "center" });
		return true;
	}, []);
	const spyActiveSection = useCallback(() => {
		if (!restoredStacked.current) return;
		cancelAnimationFrame(spyFrame.current);
		spyFrame.current = requestAnimationFrame(() => {
			if (settling.current) {
				revealComment();
				return;
			}
			const scroller = scrollerRef.current;
			if (!scroller) return;
			const edge = scroller.getBoundingClientRect().top + SECTION_HEADER_HEIGHT / 2;
			let active: string | null = null;
			for (const section of scroller.querySelectorAll<HTMLElement>(
				'[data-testid="changes-section"]',
			)) {
				if (section.getBoundingClientRect().top <= edge) active = section.dataset.path ?? null;
			}
			if (active !== null && active !== activePathRef.current) {
				setActivePath(workspaceId, tabId, active);
			}
		});
	}, [restoredStacked, revealComment, setActivePath, tabId, workspaceId]);
	useEffect(() => () => cancelAnimationFrame(spyFrame.current), []);

	useEffect(() => {
		if (!reveal || !status) return;
		const index = files.findIndex((change) => change.path === reveal.path);
		if (index < 0) {
			consumeReveal(workspaceId, tabId, null);
			return;
		}
		const target = {
			path: reveal.path,
			...(reveal.commentId ? { commentId: reveal.commentId } : {}),
		};
		releaseSettling();
		consumeReveal(workspaceId, tabId, target);
		if (layout === "stacked") {
			restoredStacked.current = true;
			scrollToSection(index, target);
		}
	}, [
		consumeReveal,
		files,
		layout,
		releaseSettling,
		restoredStacked,
		scrollToSection,
		status,
		tabId,
		reveal,
		workspaceId,
	]);

	const pendingReveal = reveal !== null;
	useEffect(() => {
		if (layout !== "stacked") {
			restoredStacked.current = false;
			settling.current = null;
			return;
		}
		if (pendingReveal || !status || restoredStacked.current) return;
		restoredStacked.current = true;
		const index = files.findIndex((change) => change.path === activePathRef.current);
		const change = files[index];
		if (!change) return;
		const frame = requestAnimationFrame(() => scrollToSection(index, { path: change.path }));
		return () => cancelAnimationFrame(frame);
	}, [files, layout, pendingReveal, restoredStacked, scrollToSection, status]);

	const onTotalListHeightChanged = useCallback(() => {
		if (revealComment()) return;
		const index = files.findIndex((change) => change.path === settling.current?.path);
		if (index >= 0) {
			virtuoso.current?.scrollToIndex({ index, align: "start" });
			return;
		}
		releaseSettling();
		spyActiveSection();
	}, [files, releaseSettling, revealComment, spyActiveSection]);

	return { virtuoso, attachScroller, tailHeight, spyActiveSection, onTotalListHeightChanged };
}
