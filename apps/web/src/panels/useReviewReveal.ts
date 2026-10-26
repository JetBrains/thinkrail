import type { GitFileChange, GitStatus } from "@thinkrail/contracts";
import {
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
const HANDOFF_MAX_FRAMES = 30;
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

type SettleTarget = { path: string; commentId?: string };

interface ReviewRevealInput {
	workspaceId: string;
	tabId: string;
	files: readonly GitFileChange[];
	status: GitStatus | null;
	statusSettled: boolean;
	readKey: string;
	layout: ChangesLayout;
	reveal: ChangesTabReveal | null;
	activePath: string | null;
}

interface ReviewReveal {
	virtuoso: RefObject<VirtuosoHandle | null>;
	attachScroller: (element: HTMLElement | Window | null) => void;
	tailHeight: number;
	spyActiveSection: () => void;
	onTotalListHeightChanged: () => void;
	handoffPath: string | null;
	startHandoff: (path: string | null) => void;
}

export function useReviewReveal({
	workspaceId,
	tabId,
	files,
	status,
	statusSettled,
	readKey,
	layout,
	reveal,
	activePath,
}: ReviewRevealInput): ReviewReveal {
	const setActivePath = useAppStore((state) => state.setChangesTabActivePath);
	const consumeReveal = useAppStore((state) => state.consumeChangesTabReveal);

	const virtuoso = useRef<VirtuosoHandle>(null);
	const scrollerRef = useRef<HTMLElement | null>(null);
	const [tailHeight, setTailHeight] = useState(0);
	const tailObserver = useRef<ResizeObserver | null>(null);
	const restoredStacked = useRef(false);
	const [handoffPath, setHandoffPath] = useState<string | null>(null);
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
	}, [revealComment, setActivePath, tabId, workspaceId]);
	useEffect(() => () => cancelAnimationFrame(spyFrame.current), []);

	useEffect(() => {
		if (!reveal || !status) return;
		const index = files.findIndex((change) => change.path === reveal.path);
		if (index < 0) {
			if (statusSettled) consumeReveal(workspaceId, tabId, null);
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
		scrollToSection,
		status,
		statusSettled,
		tabId,
		reveal,
		workspaceId,
	]);

	useEffect(() => {
		restoredStacked.current = false;
	}, [readKey]);

	const pendingReveal = reveal !== null;
	useEffect(() => {
		if (layout !== "stacked") {
			restoredStacked.current = false;
			settling.current = null;
			return;
		}
		if (pendingReveal || !status || restoredStacked.current) return;
		const index = files.findIndex((change) => change.path === activePathRef.current);
		const change = files[index];
		if (!change && activePathRef.current !== null && !statusSettled) return;
		restoredStacked.current = true;
		if (!change) return;
		let scrolled = false;
		const frame = requestAnimationFrame(() => {
			scrolled = true;
			scrollToSection(index, { path: change.path });
		});
		return () => {
			cancelAnimationFrame(frame);
			if (!scrolled) restoredStacked.current = false;
		};
	}, [files, layout, pendingReveal, scrollToSection, status, statusSettled]);

	useEffect(() => {
		if (handoffPath === null || layout !== "stacked") return;
		let frame = 0;
		let frames = 0;
		let last = Number.NaN;
		const check = () => {
			frames += 1;
			const scroller = scrollerRef.current;
			const section = scroller
				? [...scroller.querySelectorAll<HTMLElement>('[data-testid="changes-section"]')].find(
						(element) => element.dataset.path === handoffPath,
					)
				: undefined;
			const offset =
				section && scroller
					? section.getBoundingClientRect().top - scroller.getBoundingClientRect().top
					: Number.NaN;
			if ((Math.abs(offset) < 1 && Math.abs(offset - last) < 1) || frames > HANDOFF_MAX_FRAMES) {
				setHandoffPath(null);
				return;
			}
			last = offset;
			frame = requestAnimationFrame(check);
		};
		frame = requestAnimationFrame(check);
		return () => cancelAnimationFrame(frame);
	}, [handoffPath, layout]);

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

	return {
		virtuoso,
		attachScroller,
		tailHeight,
		spyActiveSection,
		onTotalListHeightChanged,
		handoffPath,
		startHandoff: setHandoffPath,
	};
}
