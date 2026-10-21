import type { AnnotationSide, FileDiffMetadata, Hunk, SelectedLineRange } from "@pierre/diffs";
import type { MessageKey } from "@thinkrail/locales";
import { t } from "@thinkrail/locales/react";
import { type RefObject, useEffect } from "react";
import type { AnchorDraft, ResourceDiffProps, ReviewThread, SurfaceReview } from "../../registry";
import type { PierreVirtualizer } from "./pierreVirtualizer";

export const COLLAPSED_CONTEXT_THRESHOLD = 3;

export interface RenderedDiffLines {
	additions: ReadonlySet<number>;
	deletions: ReadonlySet<number>;
}

export function threadLineRange(
	thread: Pick<ReviewThread, "anchor">,
): { startLine: number; endLine: number } | null {
	const range = thread.anchor.selectors.find((selector) => selector.kind === "lineRange");
	return range?.kind === "lineRange"
		? { startLine: range.startLine, endLine: range.endLine }
		: null;
}

export function draftLineLabel(startLine: number, endLine: number): string {
	return startLine === endLine ? `L${startLine}` : `L${startLine}–${endLine}`;
}

export function composerLineLabel(startLine: number, endLine: number): string {
	return startLine === endLine
		? t("viewer.code.line", { line: startLine })
		: t("viewer.code.lines", { start: startLine, end: endLine });
}

export interface OpenComposer {
	kind: "composer";
	id: number;
	side: AnnotationSide;
	lineNumber: number;
	draft: AnchorDraft;
	label: string;
	initialText?: string;
	notice?: string;
}

export interface BlockedSelection {
	kind: "blocked";
	id: number;
	side: AnnotationSide;
	lineNumber: number;
	message: MessageKey;
}

export const CROSS_SIDE_MESSAGE = "viewer.code.crossSide" satisfies MessageKey;

export function selectionComposer(
	range: SelectedLineRange,
	id: number,
): OpenComposer | BlockedSelection {
	const startSide = range.side ?? "additions";
	const endSide = range.endSide ?? startSide;
	if (startSide !== endSide) {
		return {
			kind: "blocked",
			id,
			side: endSide,
			lineNumber: range.end,
			message: CROSS_SIDE_MESSAGE,
		};
	}
	const startLine = Math.min(range.start, range.end);
	const endLine = Math.max(range.start, range.end);
	return {
		kind: "composer",
		id,
		side: startSide,
		lineNumber: endLine,
		draft: {
			selectors: [{ kind: "lineRange", startLine, endLine }],
			label: draftLineLabel(startLine, endLine),
		},
		label: composerLineLabel(startLine, endLine),
	};
}

export function renderedDiffLineNumbers(
	fileDiff: FileDiffMetadata,
	collapsedContextThreshold = COLLAPSED_CONTEXT_THRESHOLD,
): RenderedDiffLines {
	const additions = new Set<number>();
	const deletions = new Set<number>();
	for (const hunk of fileDiff.hunks) {
		addHunkSideLines(additions, hunk, "additions", fileDiff.isPartial, collapsedContextThreshold);
		addHunkSideLines(deletions, hunk, "deletions", fileDiff.isPartial, collapsedContextThreshold);
	}
	addTrailingLines(fileDiff, additions, deletions, collapsedContextThreshold);
	return { additions, deletions };
}

export function filePlacedThreadIds(
	text: string,
	threads: readonly ReviewThread[],
): ReadonlySet<string> {
	const lineCount = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
	const ids = new Set<string>();
	for (const thread of threads) {
		const range = threadLineRange(thread);
		if (range && range.endLine >= 1 && range.endLine <= lineCount) ids.add(thread.id);
	}
	return ids;
}

export function diffPlacedThreadIds(
	fileDiff: FileDiffMetadata,
	review: ResourceDiffProps["review"],
	collapsedContextThreshold = COLLAPSED_CONTEXT_THRESHOLD,
): ReadonlySet<string> {
	const rendered = renderedDiffLineNumbers(fileDiff, collapsedContextThreshold);
	const ids = new Set<string>();
	for (const [surface, side] of [
		[review?.base, "deletions"],
		[review?.worktree, "additions"],
	] as const) {
		for (const thread of surface?.threads ?? []) {
			const range = threadLineRange(thread);
			if (range && rendered[side].has(range.endLine)) ids.add(thread.id);
		}
	}
	return ids;
}

function hunkSide(hunk: Hunk, side: AnnotationSide): { start: number; count: number } {
	return side === "additions"
		? { start: hunk.additionStart, count: hunk.additionCount }
		: { start: hunk.deletionStart, count: hunk.deletionCount };
}

function sideEndBoundary(start: number, count: number): number {
	return start - (count === 0 ? 0 : 1) + count;
}

function addRange(target: Set<number>, start: number, end: number): void {
	for (let line = Math.max(1, start); line <= end; line++) target.add(line);
}

function addHunkSideLines(
	target: Set<number>,
	hunk: Hunk,
	side: AnnotationSide,
	isPartial: boolean,
	collapsedContextThreshold: number,
): void {
	const { start, count } = hunkSide(hunk, side);
	const startBoundary = start - (count === 0 ? 0 : 1);
	const collapsedBefore = Math.max(0, hunk.collapsedBefore);
	if (!isPartial && collapsedBefore > 0 && collapsedBefore <= collapsedContextThreshold) {
		addRange(target, startBoundary + 1 - collapsedBefore, startBoundary);
	}
	if (count > 0) addRange(target, startBoundary + 1, startBoundary + count);
}

function addTrailingLines(
	fileDiff: FileDiffMetadata,
	additions: Set<number>,
	deletions: Set<number>,
	collapsedContextThreshold: number,
): void {
	const lastHunk = fileDiff.hunks.at(-1);
	if (
		!lastHunk ||
		fileDiff.isPartial ||
		fileDiff.additionLines.length === 0 ||
		fileDiff.deletionLines.length === 0
	) {
		return;
	}
	const additionEnd = sideEndBoundary(lastHunk.additionStart, lastHunk.additionCount);
	const deletionEnd = sideEndBoundary(lastHunk.deletionStart, lastHunk.deletionCount);
	const additionRemaining = fileDiff.additionLines.length - additionEnd;
	const deletionRemaining = fileDiff.deletionLines.length - deletionEnd;
	if (
		additionRemaining <= 0 ||
		additionRemaining !== deletionRemaining ||
		additionRemaining > collapsedContextThreshold
	) {
		return;
	}
	addRange(additions, additionEnd + 1, fileDiff.additionLines.length);
	addRange(deletions, deletionEnd + 1, fileDiff.deletionLines.length);
}

export interface FocusSurface {
	review: SurfaceReview | undefined;
	side?: AnnotationSide;
}

export function usePierreFocus(
	rootRef: RefObject<HTMLDivElement | null>,
	virtualizer: PierreVirtualizer,
	surfaces: readonly FocusSurface[],
	placedThreadIds?: ReadonlySet<string>,
): void {
	const focusedSurface = surfaces.find(
		({ review }) =>
			review?.focus && (placedThreadIds === undefined || placedThreadIds.has(review.focus.id)),
	);
	const focused = focusedSurface?.review?.focus ?? null;
	const focusId = focused?.id ?? null;
	const focusLine = focused ? (threadLineRange(focused)?.endLine ?? null) : null;
	const focusSide = focusedSurface?.side;
	const onFocusHandled = surfaces.find(({ review }) => review?.focus?.id === focusId)?.review
		?.onFocusHandled;
	useEffect(() => {
		if (!focusId || !onFocusHandled) return;
		let card: HTMLElement | undefined;
		let handled = false;
		let lineRevealed = focusLine === null;
		const sizeObserver = new ResizeObserver(() => reveal());
		const findCard = () => {
			const next = [
				...(rootRef.current?.querySelectorAll<HTMLElement>("[data-comment-id]") ?? []),
			].find((element) => element.dataset.commentId === focusId);
			if (next && next !== card) {
				if (card) sizeObserver.unobserve(card);
				card = next;
				sizeObserver.observe(next);
			}
			return next;
		};
		const reveal = () => {
			const target = card?.isConnected ? card : findCard();
			const rendered = target !== undefined && target.getClientRects().length > 0;
			if (!rendered && !lineRevealed && focusLine !== null) {
				lineRevealed = virtualizer.revealLine(focusLine, focusSide);
			}
			if (!target || !rendered || handled) return;
			handled = true;
			target.scrollIntoView({ block: "center" });
			onFocusHandled();
			sizeObserver.disconnect();
			mutationObserver.disconnect();
		};
		const mutationObserver = new MutationObserver(reveal);
		const root = rootRef.current;
		if (root) mutationObserver.observe(root, { childList: true, subtree: true });
		if (root?.firstElementChild) sizeObserver.observe(root.firstElementChild);
		reveal();
		return () => {
			sizeObserver.disconnect();
			mutationObserver.disconnect();
		};
	}, [focusId, focusLine, focusSide, onFocusHandled, rootRef, virtualizer]);
}
