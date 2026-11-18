import { RiChatNewLine as MessageSquarePlus } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import {
	type FocusEvent,
	type KeyboardEvent,
	type ReactNode,
	type RefCallback,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import type { ReviewThread, SurfaceReview } from "../registry";
import {
	type BlockCursorState,
	blockCursorCommand,
	blockIndexAt,
	blockRange,
	blockRangeLines,
	blockText,
	type CursorBlock,
	cursorBlockElements,
	cursorBlocksOf,
	firstVisibleBlock,
} from "./blockCursor";
import { CURSOR_PROXY_HOST, type CursorOption, CursorProxy } from "./CursorProxy";
import { cursorCommand, useReviewSurfaceKeys } from "./cursorKeys";
import { mapPreviewSelection } from "./previewAnchor";
import { ReviewComposer } from "./ReviewComposer";
import { revealReviewCard } from "./revealFocus";
import { markReviewRegions, type SourceLineRange, stampedSelectionLines } from "./sourceLines";

const BLOCK_CURSOR = "data-review-block-cursor";
const BLOCK_RANGE = "data-review-block-range";

export type PreviewReturnFocus = (line: number | undefined) => void;

export interface ComposerInsert {
	line: number;
	node: ReactNode;
}

function sameOption(left: CursorOption | null, right: CursorOption | null): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.key === right.key &&
			left.place === right.place &&
			left.text === right.text &&
			left.extent === right.extent &&
			left.position === right.position &&
			left.size === right.size)
	);
}

function threadLineRange(thread: ReviewThread): SourceLineRange | null {
	const range = thread.anchor.selectors.find((selector) => selector.kind === "lineRange");
	return range?.kind === "lineRange"
		? { startLine: range.startLine, endLine: range.endLine }
		: null;
}

export function PreviewCommenting({
	source,
	review,
	testid = "markdown-preview",
	surfaceClassName = "relative h-full overflow-auto bg-container-workspace-bg motion-safe:animate-reveal",
	canCommentSelection,
	scrollerRef,
	attachScroller,
	children,
}: {
	source: string;
	review: SurfaceReview;
	testid?: string;
	surfaceClassName?: string;
	canCommentSelection?: (selection: Selection, scroller: HTMLElement) => boolean;
	scrollerRef: RefObject<HTMLDivElement | null>;
	attachScroller: RefCallback<HTMLDivElement>;
	children: (composer: ComposerInsert | null, returnFocus: PreviewReturnFocus) => ReactNode;
}) {
	const t = useT();
	const keys = useReviewSurfaceKeys();
	const iconRef = useRef<HTMLButtonElement>(null);
	const draggingRef = useRef(false);
	const [selection, setSelection] = useState<SourceLineRange | null>(null);
	const [composing, setComposing] = useState(false);
	const selectedTextRef = useRef("");
	const [proxy, setProxy] = useState<HTMLDivElement | null>(null);
	const [blockCursor, setBlockCursor] = useState<BlockCursorState | null>(null);
	const [cursorShown, setCursorShown] = useState(false);
	const [cursorOption, setCursorOption] = useState<CursorOption | null>(null);
	const { commenting, threads } = review;

	const linesLabel = (lines: SourceLineRange) =>
		lines.startLine === lines.endLine
			? t("panels.reviewZones.line", { line: lines.startLine })
			: t("panels.reviewZones.lines", { start: lines.startLine, end: lines.endLine });

	const blockOption = (
		elements: readonly HTMLElement[],
		blocks: readonly CursorBlock[],
		at: BlockCursorState,
	): CursorOption | null => {
		const index = blockIndexAt(blocks, at.line);
		const block = blocks[index];
		const element = elements[index];
		if (!block || !element) return null;
		const { from, to } = blockRange(blocks, at);
		const range = from === to ? null : blockRangeLines(blocks, at);
		return {
			key: `${block.start}${range ? `-${at.anchor}` : ""}`,
			place: linesLabel({ startLine: block.start, endLine: block.end }),
			text: blockText(element),
			extent: range ? linesLabel(range) : null,
			position: index + 1,
			size: blocks.length,
		};
	};

	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		for (const element of scroller.querySelectorAll(`[${BLOCK_CURSOR}], [${BLOCK_RANGE}]`)) {
			element.removeAttribute(BLOCK_CURSOR);
			element.removeAttribute(BLOCK_RANGE);
		}
		const elements = cursorBlockElements(scroller);
		const blocks = cursorBlocksOf(elements);
		const at = blockCursor ?? firstVisibleBlock(elements, scroller);
		const option = at ? blockOption(elements, blocks, at) : null;
		setCursorOption((current) => (sameOption(current, option) ? current : option));
		if (!cursorShown || !blockCursor) return;
		if (blockCursor.anchor !== null) {
			const { from, to } = blockRange(blocks, blockCursor);
			for (const element of elements.slice(from, to + 1)) element.setAttribute(BLOCK_RANGE, "");
		}
		elements[blockIndexAt(blocks, blockCursor.line)]?.setAttribute(BLOCK_CURSOR, "");
	});

	const focusId = review.focus?.id ?? null;
	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!focusId || !scroller) return;
		const card = scroller.querySelector(`[data-comment-id="${focusId}"]`);
		if (card) {
			revealReviewCard(card, review.focus?.moveFocus === true);
			review.onFocusHandled();
		}
	}, [focusId, review]);

	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		const ranges = threads.flatMap((thread) => {
			const range = threadLineRange(thread);
			return range ? [range] : [];
		});
		if (composing && selection) ranges.push(selection);
		markReviewRegions(scroller, ranges);
	}, [threads, composing, selection]);

	useEffect(() => {
		if (composing) {
			iconRef.current?.removeAttribute("data-visible");
			return;
		}
		const hideIcon = () => iconRef.current?.removeAttribute("data-visible");
		const evaluate = () => {
			const scroller = scrollerRef.current;
			const node = iconRef.current;
			const sel = document.getSelection();
			if (!scroller || !node || !sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.focusNode) {
				hideIcon();
				return;
			}
			const range = sel.getRangeAt(0);
			if (
				!scroller.contains(range.commonAncestorContainer) ||
				(canCommentSelection && !canCommentSelection(sel, scroller))
			) {
				hideIcon();
				return;
			}
			const focusRange = document.createRange();
			try {
				focusRange.setStart(sel.focusNode, sel.focusOffset);
				focusRange.collapse(true);
			} catch {
				hideIcon();
				return;
			}
			const rect = focusRange.getClientRects()[0] ?? range.getBoundingClientRect();
			const box = scroller.getBoundingClientRect();
			selectedTextRef.current = sel.toString();
			const above = rect.top - 28;
			const top = above >= box.top ? above : rect.bottom + 4;
			const left = Math.max(box.left + 4, Math.min(rect.right + 6, box.right - 34));
			node.style.setProperty("--review-icon-top", `${top}px`);
			node.style.setProperty("--review-icon-left", `${left}px`);
			if (draggingRef.current) node.setAttribute("data-dragging", "true");
			node.setAttribute("data-visible", "true");
		};
		const onPointerDown = (e: PointerEvent) => {
			if (e.button === 0 && !iconRef.current?.contains(e.target as Node | null)) {
				draggingRef.current = true;
				iconRef.current?.setAttribute("data-dragging", "true");
			}
		};
		const onPointerUp = () => {
			draggingRef.current = false;
			iconRef.current?.removeAttribute("data-dragging");
			evaluate();
		};
		const scroller = scrollerRef.current;
		document.addEventListener("selectionchange", evaluate);
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("pointerup", onPointerUp);
		scroller?.addEventListener("scroll", evaluate, { passive: true });
		return () => {
			document.removeEventListener("selectionchange", evaluate);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("pointerup", onPointerUp);
			scroller?.removeEventListener("scroll", evaluate);
		};
	}, [composing, canCommentSelection]);

	const openComposer = () => {
		const scroller = scrollerRef.current;
		const selected = document.getSelection();
		if (
			!iconRef.current?.hasAttribute("data-visible") ||
			!scroller ||
			!selected ||
			(canCommentSelection && !canCommentSelection(selected, scroller))
		) {
			return;
		}
		const resolved =
			stampedSelectionLines(scroller) ?? mapPreviewSelection(source, selectedTextRef.current);
		if (resolved) setBlockCursor({ line: resolved.startLine, anchor: null });
		setSelection(resolved);
		setComposing(true);
	};

	const close = () => {
		setComposing(false);
		setSelection(null);
	};

	const returnFocus: PreviewReturnFocus = (line) => {
		if (line !== undefined) setBlockCursor({ line, anchor: null });
		proxy?.focus({ preventScroll: true });
		const shown = line ?? blockCursor?.line;
		const scroller = proxy?.parentElement;
		if (shown === undefined || !scroller) return;
		const elements = cursorBlockElements(scroller);
		elements[blockIndexAt(cursorBlocksOf(elements), shown)]?.scrollIntoView({ block: "nearest" });
	};

	const onCursorKey = (event: KeyboardEvent<HTMLDivElement>) => {
		const scroller = scrollerRef.current;
		const command = cursorCommand(event.nativeEvent, keys);
		if (!scroller || !command) return;
		const elements = cursorBlockElements(scroller);
		const blocks = cursorBlocksOf(elements);
		const start = blockCursor ?? firstVisibleBlock(elements, scroller);
		const outcome = start ? blockCursorCommand(blocks, start, command) : null;
		if (!outcome) return;
		event.preventDefault();
		if (outcome.kind === "comment") {
			setBlockCursor({ line: start?.line ?? outcome.lines.startLine, anchor: null });
			setSelection(outcome.lines);
			setComposing(true);
			return;
		}
		setBlockCursor(outcome.state);
		setCursorShown(true);
		elements[blockIndexAt(blocks, outcome.state.line)]?.scrollIntoView({ block: "nearest" });
	};

	const onCursorFocus = (event: FocusEvent<HTMLDivElement>) => {
		const scroller = scrollerRef.current;
		const visible = event.currentTarget.matches(":focus-visible");
		setCursorShown(visible);
		if (visible && !blockCursor && scroller) {
			setBlockCursor(firstVisibleBlock(cursorBlockElements(scroller), scroller));
		}
	};

	const onCursorBlur = () => setCursorShown(false);

	const label = selection ? linesLabel(selection) : t("panels.previewCommenting.wholeFile");

	const draft = selection
		? {
				selectors: [{ kind: "lineRange" as const, ...selection }],
				label:
					selection.startLine === selection.endLine
						? `L${selection.startLine}`
						: `L${selection.startLine}–${selection.endLine}`,
			}
		: { selectors: [], label: "file" };
	const composerInsert: ComposerInsert | null = composing
		? {
				line: selection?.endLine ?? Number.MAX_SAFE_INTEGER,
				node: (
					<ReviewComposer
						key="review-composer"
						draft={draft}
						label={label}
						commenting={commenting}
						onClose={close}
						onReturnFocus={() => returnFocus(undefined)}
						className="review-composer-flow"
					/>
				),
			}
		: null;

	return (
		<div
			ref={attachScroller}
			data-testid={testid}
			className={cn(
				surfaceClassName,
				CURSOR_PROXY_HOST,
				"[&_[data-review-block-cursor]]:focus-ring [&_tr[data-review-block-cursor]]:bg-primary-subtle [&_[data-review-block-range]]:bg-primary-subtle",
			)}
		>
			{cursorOption ? (
				<CursorProxy
					ref={setProxy}
					label={t("viewer.markdown.blocks")}
					option={cursorOption}
					onKeyDown={onCursorKey}
					onFocus={onCursorFocus}
					onBlur={onCursorBlur}
				/>
			) : null}
			{children(composerInsert, returnFocus)}
			{createPortal(
				<IconButton
					ref={iconRef}
					icon={MessageSquarePlus}
					label={t("panels.previewCommenting.commentOnSelection")}
					variant="outline"
					size="s"
					data-testid="review-add-icon"
					onMouseDown={(e) => e.preventDefault()}
					onClick={openComposer}
					className="review-add-icon-float shadow-[var(--shadow-sm)]"
				/>,
				document.body,
			)}
		</div>
	);
}
