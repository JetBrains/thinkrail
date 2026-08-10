import { MessageSquarePlus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mapPreviewSelection } from "./previewAnchor";
import type { LineSelection } from "./reviewGutter";
import type { ReviewCommentingCallbacks } from "./reviewWidgets";
import { markReviewRegions, stampedSelectionLines } from "./sourceLines";
import type { EditorReview } from "./useReviewCommenting";

/** What the preview splices for an open composer: its anchor line + the rendered card. */
export interface ComposerInsert {
	line: number;
	node: ReactNode;
}

/**
 * Selection-triggered commenting for the RENDERED markdown view (the React sibling of the Monaco
 * `reviewWidgets`, wearing the same `.review-add-icon`/`.review-composer` skin): selecting text shows
 * the floating comment icon at the selection's focus end, live while the drag runs (mouse-transparent
 * until release — see the effect note); clicking it opens the composer — which, like
 * the saved cards, sits IN the document flow directly below the selected block (`MarkdownPreview`
 * splices it via the children-as-function contract; only the transient icon stays floating). The
 * selection resolves to source lines through the stamped blocks (`sourceLineRehype` — exact remark
 * positions), falling back to `previewAnchor`'s phrase search for unstamped content; a selection
 * neither can place degrades to a whole-file comment — the composer says so — never to wrong lines.
 *
 * Region parity with Monaco: the blocks under every unresolved comment — and under the composer's
 * target while it is open — wear `.review-region` (`markReviewRegions`), the preview's twin of the
 * editor's commented-line decoration.
 */
export function PreviewCommenting({
	source,
	review,
	children,
}: {
	/** The file's SOURCE text (what line anchors point into). */
	source: string;
	review: EditorReview;
	/** Renders the document, splicing the given composer insert (null = not composing). */
	children: (composer: ComposerInsert | null) => ReactNode;
}) {
	const scrollerRef = useRef<HTMLDivElement>(null);
	const iconRef = useRef<HTMLButtonElement>(null);
	// The icon's whole lifecycle is REFS + imperative DOM, deliberately never React state: the markdown
	// components are per-render-typed, so ANY state flip remounts the document's text nodes — under a
	// mousedown it swallowed the click being made, and under a LIVE drag it replaced the nodes the
	// native selection anchored to, which Chrome "restores" by flooding whole blocks (selecting a few
	// words painted the entire bullet). The node is always mounted (a body portal); position rides the
	// `--review-icon-*` custom properties and visibility the `data-visible` attribute.
	const draggingRef = useRef(false);
	const [selection, setSelection] = useState<LineSelection | null>(null);
	const [composing, setComposing] = useState(false);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const selectedTextRef = useRef("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const { commenting, threads } = review;

	// Focus the just-opened composer (an effect, not the autofocus attribute — the composer mounts on a
	// user gesture, so stealing focus is exactly what's wanted, and only then).
	useEffect(() => {
		if (composing) inputRef.current?.focus();
	}, [composing]);

	// The Review panel's "focus this comment" deep link: scroll the in-flow card into view, then
	// consume the request so it fires exactly once.
	const focusId = review.focus?.id ?? null;
	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!focusId || !scroller) return;
		scroller.querySelector(`[data-comment-id="${focusId}"]`)?.scrollIntoView({ block: "center" });
		review.onFocusHandled();
	}, [focusId, review]);

	// Region parity with Monaco: gold-mark the blocks under every unresolved comment, plus the
	// composer's target while it is open. Runs after render, so freshly spliced segments are stamped.
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
			iconRef.current?.removeAttribute("data-visible"); // frozen + hidden while composing
			return;
		}
		const hideIcon = () => iconRef.current?.removeAttribute("data-visible");
		// The icon follows the selection LIVE — including mid-drag, floating right of the focus point —
		// via IMPERATIVE positioning only (see the refs note above: a setState here would remount the
		// text nodes under the live selection). It stays mouse-transparent until the drag ends
		// (`data-dragging` → `pointer-events: none`): a clickable DOM node under the moving cursor is
		// one the native selection extends INTO, repainting the document tail as selected.
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
			// The focus point — where the cursor ended (top when selecting upward), same as Monaco's side.
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
			// VIEWPORT (fixed) coordinates — the icon lives in a body portal, outside the preview's DOM,
			// so the native selection can never reach it. Strictly ABOVE the focus line (falling below it
			// only when the line touches the pane's top edge): on the line itself the button covers the
			// just-selected words and reads as a hole punched in the selection.
			const above = rect.top - 28;
			const top = above >= box.top ? above : rect.bottom + 4;
			const left = Math.max(box.left + 4, Math.min(rect.right + 6, box.right - 34));
			node.style.setProperty("--review-icon-top", `${top}px`);
			node.style.setProperty("--review-icon-left", `${left}px`);
			if (draggingRef.current) node.setAttribute("data-dragging", "true");
			node.setAttribute("data-visible", "true");
		};
		const onPointerDown = (e: PointerEvent) => {
			// A press on the icon itself is the click, not a new drag — it must stay clickable through it.
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
		// Exact lines from the stamped blocks first; the phrase search covers unstamped content.
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

	// Splice fallback for an unmappable selection: after the whole document (the preview's tail).
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
			{
				// A BODY portal, ALWAYS mounted (visibility + position are imperative — see the refs note):
				// the button is not a child of the scroller, so the DOM selection can never extend into it —
				// it floats OVER the text and cannot influence the selection at all.
				createPortal(
					<button
						ref={iconRef}
						type="button"
						data-testid="review-add-icon"
						title="Comment on selection"
						aria-label="Comment on selection"
						onMouseDown={(e) => e.preventDefault() /* keep the selection through the click */}
						onClick={openComposer}
						className="review-add-icon review-add-icon-float"
					>
						<MessageSquarePlus className="size-3.5" />
					</button>,
					document.body,
				)
			}
		</div>
	);
}
