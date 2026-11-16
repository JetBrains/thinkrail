import {
	type AnnotationSide,
	DIFFS_TAG_NAME,
	type FileDiffMetadata,
	type SelectedLineRange,
} from "@pierre/diffs";
import { useT } from "@thinkrail/locales/react";
import { TABBABLE_SELECTOR } from "@thinkrail/ui/focus";
import {
	type FocusEvent,
	type KeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { CursorOption, CursorProxyProps } from "../../support/CursorProxy";
import { cursorCommand, useReviewSurfaceKeys } from "../../support/cursorKeys";
import { commentCard, focusBefore, focusReviewCard } from "../../support/revealFocus";
import {
	type DiffCursor,
	type DiffCursorLayout,
	type DiffCursorState,
	type DiffRow,
	diffCursorCommand,
	diffCursorRange,
	diffCursorRow,
	diffCursorStop,
	diffLineText,
	snapDiffCursor,
} from "./diffCursor";
import type { PierreVirtualizer } from "./pierreVirtualizer";

export interface DiffCursorTarget {
	id: string | null;
	line: number;
	side: AnnotationSide;
}

const REVEAL_FRAMES = 30;
const REVEAL_MARGIN = 48;
const COMPOSER_SELECTOR = '[data-testid="review-composer"]';

function sameRange(left: SelectedLineRange | null, right: SelectedLineRange | null): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.start === right.start &&
			left.end === right.end &&
			left.side === right.side &&
			left.endSide === right.endSide)
	);
}

function rowElement(
	host: HTMLElement,
	layout: DiffCursorLayout,
	cursor: DiffCursor,
): Element | null {
	const root = host.querySelector(DIFFS_TAG_NAME)?.shadowRoot;
	if (!root) return null;
	const line = `[data-line="${cursor.line}"]`;
	if (layout === "split") return root.querySelector(`[data-${cursor.side}] ${line}`);
	return root.querySelector(
		cursor.side === "deletions"
			? `${line}[data-line-type="change-deletion"]`
			: `${line}:not([data-line-type="change-deletion"])`,
	);
}

function scrollableAncestor(element: HTMLElement): HTMLElement | null {
	for (let node: HTMLElement | null = element; node; node = node.parentElement) {
		const overflow = getComputedStyle(node).overflowY;
		if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) {
			return node;
		}
	}
	return null;
}

function revealNearest(element: Element, host: HTMLElement): void {
	const scroller = scrollableAncestor(host);
	if (!scroller) return;
	const box = scroller.getBoundingClientRect();
	const rect = element.getBoundingClientRect();
	const top = box.top + REVEAL_MARGIN;
	const bottom = box.top + scroller.clientHeight - REVEAL_MARGIN;
	if (rect.top < top) scroller.scrollTop += rect.top - top;
	else if (rect.bottom > bottom) scroller.scrollTop += rect.bottom - bottom;
}

function focusTarget(host: HTMLElement, target: DiffCursorTarget): boolean {
	const element =
		target.id === null ? host.querySelector(COMPOSER_SELECTOR) : commentCard(host, target.id);
	if (!element || element.getClientRects().length === 0 || !focusReviewCard(element)) return false;
	revealNearest(element, host);
	return true;
}

function focusTargetWhenRendered(host: HTMLElement, target: DiffCursorTarget): void {
	let frames = REVEAL_FRAMES;
	const attempt = () => {
		if (!focusTarget(host, target) && frames-- > 0) requestAnimationFrame(attempt);
	};
	requestAnimationFrame(attempt);
}

function leaveDiff(host: HTMLElement): void {
	const row = host.parentElement?.closest<HTMLElement>("[data-focus-row]");
	const outside = (element: HTMLElement) =>
		!host.contains(element) && element.getClientRects().length > 0;
	const header =
		Array.from(row?.querySelectorAll<HTMLElement>("[data-focus-row-primary]") ?? []).find(
			outside,
		) ?? Array.from(row?.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR) ?? []).find(outside);
	if (header) header.focus();
	else focusBefore(host);
}

export function useDiffCursor({
	enabled,
	fileDiff,
	rows,
	layout,
	rootRef,
	virtualizer,
	virtualize,
	targets,
	label,
	onComment,
	onEscape,
}: {
	enabled: boolean;
	fileDiff: FileDiffMetadata;
	rows: readonly DiffRow[];
	layout: DiffCursorLayout;
	rootRef: RefObject<HTMLDivElement | null>;
	virtualizer: PierreVirtualizer;
	virtualize: boolean;
	targets: readonly DiffCursorTarget[];
	label: string;
	onComment: (range: SelectedLineRange) => void;
	onEscape: () => boolean;
}) {
	const t = useT();
	const keys = useReviewSurfaceKeys();
	const proxyRef = useRef<HTMLDivElement>(null);
	const [stored, setStored] = useState<DiffCursorState | null>(null);
	const [shown, setShown] = useState(false);
	const [drawn, setDrawn] = useState<SelectedLineRange | null>(null);
	const cursor = enabled ? snapDiffCursor(rows, layout, stored?.cursor ?? null) : null;
	const anchor =
		cursor && stored?.anchor && diffCursorRow(rows, layout, stored.anchor) >= 0
			? stored.anchor
			: null;
	const state: DiffCursorState | null = cursor ? { cursor, anchor } : null;
	const wanted = shown && state ? diffCursorRange(state) : null;

	useEffect(() => {
		const frame = requestAnimationFrame(() =>
			setDrawn((current) => (sameRange(current, wanted) ? current : wanted)),
		);
		return () => cancelAnimationFrame(frame);
	}, [wanted]);

	const place = useCallback((next: DiffCursor) => setStored({ cursor: next, anchor: null }), []);

	const reveal = (next: DiffCursor) => {
		const host = rootRef.current;
		if (!host) return;
		if (virtualize) {
			virtualizer.revealLine(next.line, next.side, "nearest");
			return;
		}
		const row = rowElement(host, layout, next);
		if (row) revealNearest(row, host);
	};

	const focusCursor = (next?: DiffCursor) => {
		const proxy = proxyRef.current;
		if (!proxy) return;
		const at = next ?? state?.cursor;
		setStored(at ? { cursor: at, anchor: null } : null);
		proxy.focus({ preventScroll: true });
		if (at) reveal(at);
	};

	const focusNextTarget = (host: HTMLElement, from: DiffCursor): boolean => {
		const at = diffCursorRow(rows, layout, from);
		let best: { target: DiffCursorTarget; row: number } | null = null;
		for (const target of targets) {
			const row = rows.findIndex((candidate) => candidate[target.side] === target.line);
			if (row < at || (best && row >= best.row)) continue;
			best = { target, row };
		}
		if (!best) return false;
		const { target } = best;
		if (focusTarget(host, target)) return true;
		if (!virtualize) return false;
		virtualizer.revealLine(target.line, target.side);
		focusTargetWhenRendered(host, target);
		return true;
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const host = rootRef.current;
		if (!host || !state) return;
		if (event.key === "Tab") {
			const plain = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
			if (plain && focusNextTarget(host, state.cursor)) event.preventDefault();
			return;
		}
		const command = cursorCommand(event.nativeEvent, keys);
		if (!command) return;
		event.preventDefault();
		if (command.kind === "escape" && onEscape()) return;
		const outcome = diffCursorCommand(rows, layout, state, command);
		if (outcome.kind === "leave") {
			leaveDiff(host);
			return;
		}
		if (outcome.kind === "comment") {
			const { range } = outcome;
			if (range.side === range.endSide) setStored({ cursor: state.cursor, anchor: null });
			requestAnimationFrame(() => onComment(range));
			return;
		}
		setStored(outcome.state);
		setShown(true);
		reveal(outcome.state.cursor);
	};

	const onFocus = (event: FocusEvent<HTMLDivElement>) => {
		const visible = event.currentTarget.matches(":focus-visible");
		setShown(visible);
		if (visible && state) reveal(state.cursor);
	};

	const onBlur = () => setShown(false);

	const placeLabel = (at: DiffCursor) =>
		t(at.side === "deletions" ? "viewer.code.cursorOld" : "viewer.code.cursorNew", {
			line: at.line,
		});
	const option = ({ cursor: at, anchor: from }: DiffCursorState): CursorOption => {
		const ranged = from && (from.line !== at.line || from.side !== at.side) ? from : null;
		return {
			key: `${at.side}${at.line}${ranged ? `-${ranged.side}${ranged.line}` : ""}`,
			place: placeLabel(at),
			text: diffLineText(fileDiff, at),
			extent: !ranged
				? null
				: ranged.side === at.side
					? t("viewer.code.lines", {
							start: Math.min(ranged.line, at.line),
							end: Math.max(ranged.line, at.line),
						})
					: t("viewer.cursor.span", { from: placeLabel(ranged), to: placeLabel(at) }),
			...diffCursorStop(rows, layout, at),
		};
	};
	const proxy: CursorProxyProps | undefined = state
		? { ref: proxyRef, label, option: option(state), onKeyDown, onFocus, onBlur }
		: undefined;

	return { proxy, drawn, place, focusCursor };
}
