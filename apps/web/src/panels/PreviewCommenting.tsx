import { RiChatNewLine as MessageSquarePlus } from "@remixicon/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mapPreviewSelection } from "./previewAnchor";
import type { LineSelection } from "./reviewGutter";
import type { ReviewCommentingCallbacks } from "./reviewWidgets";
import { markReviewRegions, stampedSelectionLines } from "./sourceLines";
import type { EditorReview } from "./useReviewCommenting";

export interface ComposerInsert {
	line: number;
	node: ReactNode;
}

export function PreviewCommenting({
	source,
	review,
	children,
}: {
	source: string;
	review: EditorReview;
	children: (composer: ComposerInsert | null) => ReactNode;
}) {
	const scrollerRef = useRef<HTMLDivElement>(null);
	const iconRef = useRef<HTMLButtonElement>(null);
	const draggingRef = useRef(false);
	const [selection, setSelection] = useState<LineSelection | null>(null);
	const [composing, setComposing] = useState(false);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const selectedTextRef = useRef("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const { commenting, threads } = review;

	useEffect(() => {
		if (composing) inputRef.current?.focus();
	}, [composing]);

	const focusId = review.focus?.id ?? null;
	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!focusId || !scroller) return;
		scroller.querySelector(`[data-comment-id="${focusId}"]`)?.scrollIntoView({ block: "center" });
		review.onFocusHandled();
	}, [focusId, review]);

	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		const ranges: LineSelection[] = threads.map((t) => ({
			startLine: t.startLine,
			endLine: t.endLine,
		}));
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
			if (!scroller.contains(range.commonAncestorContainer)) {
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
			if (e.button === 0 && !(e.target as Element | null)?.closest?.(".review-add-icon")) {
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
	}, [composing]);

	const openComposer = () => {
		const scroller = scrollerRef.current;
		if (!iconRef.current?.hasAttribute("data-visible") || !scroller) return;
		const resolved =
			stampedSelectionLines(scroller) ?? mapPreviewSelection(source, selectedTextRef.current);
		setSelection(resolved);
		setComposing(true);
		setText("");
	};

	const close = () => {
		setComposing(false);
		setSelection(null);
		setText("");
		setBusy(false);
	};

	const submit = (action: ReviewCommentingCallbacks["onSave"]) => {
		if (!composing || !text.trim()) return;
		setBusy(true);
		action(selection, text.trim()).then(close, () => setBusy(false));
	};

	const label = selection
		? selection.startLine === selection.endLine
			? `Line ${selection.startLine}`
			: `Lines ${selection.startLine}–${selection.endLine}`
		: "Whole file (couldn't locate the fragment)";

	const composerInsert: ComposerInsert | null = composing
		? {
				line: selection?.endLine ?? Number.MAX_SAFE_INTEGER,
				node: (
					<div
						key="review-composer"
						data-testid="review-composer"
						className="review-composer review-composer-flow"
					>
						<span className="review-composer-label tr-code-text">{label}</span>
						<textarea
							ref={inputRef}
							data-testid="review-composer-input"
							className="review-composer-input tr-text-ui"
							placeholder="Leave a review comment…"
							value={text}
							disabled={busy}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => {
								if (e.nativeEvent.isComposing) return;
								if (e.key === "Escape") close();
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(commenting.onSave);
							}}
						/>
						<div className="review-composer-row">
							<button
								type="button"
								data-testid="review-composer-save"
								className="review-composer-btn tr-text-action"
								disabled={busy || !text.trim()}
								onClick={() => submit(commenting.onSave)}
							>
								Save draft
							</button>
							<button
								type="button"
								data-testid="review-composer-send"
								className="review-composer-btn review-composer-btn-primary tr-text-action"
								disabled={busy || !text.trim()}
								onClick={() => submit(commenting.onSend)}
							>
								Send now
							</button>
							<button
								type="button"
								data-testid="review-composer-cancel"
								className="review-composer-btn review-composer-btn-quiet tr-text-action"
								onClick={close}
							>
								Cancel
							</button>
						</div>
					</div>
				),
			}
		: null;

	return (
		<div
			ref={scrollerRef}
			data-testid="markdown-preview"
			className="relative h-full overflow-auto bg-container-workspace-bg"
		>
			{children(composerInsert)}
			{createPortal(
				<button
					ref={iconRef}
					type="button"
					data-testid="review-add-icon"
					title="Comment on selection"
					aria-label="Comment on selection"
					onMouseDown={(e) => e.preventDefault()}
					onClick={openComposer}
					className="review-add-icon review-add-icon-float"
				>
					<MessageSquarePlus className="size-14" />
				</button>,
				document.body,
			)}
		</div>
	);
}
