import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { stripFrontmatter } from "@/lib/utils";
import { useAppStore } from "@/store";
import {
	hasPendingEditForPath,
	keepInlineEdit,
	openInlineEditInTab,
	refineInlineEdit,
	revertAll,
	startInlineEdit,
	stopInlineEdit,
	undoLastChange,
} from "./actions";
import { resolveMarkdownSelection } from "./anchor";
import { EditActionBar } from "./EditActionBar";
import { EditStatusChip } from "./EditStatusChip";
import { InlineSuggestion } from "./InlineSuggestion";
import { InstructionPopup } from "./InstructionPopup";
import { changedLineRange } from "./lineDiff";
import { PreviewPopover } from "./PreviewPopover";
import { SelectionPill } from "./SelectionPill";
import type { InlineEditRequest, SelectionTarget } from "./types";

/** A rect-anchored floating popover needs a viewport position — kept minimal, {top,left} only. */
type Rect = { top: number; left: number };

/**
 * This path's active-request review, described as an IN-FLOW splice for `MarkdownPreview` to weave into the
 * rendered document — never a floating overlay. `range` is 1-based, against the STRIPPED (frontmatter
 * removed) rendered doc, matching what `MarkdownPreview` slices on; `null` means "couldn't be located,
 * render after the whole document" (a fallback, not a normal case). `mode` "replace" swaps the changed lines
 * out for `node`; "insert" drops `node` in right after the (unchanged) block, pushing later content down.
 */
export interface MarkdownReview {
	mode: "replace" | "insert";
	range: { start: number; end: number } | null;
	node: React.ReactNode;
}

/**
 * Controller for inline editing in the rendered-markdown view. Owns selection→pill→popup→fire and describes
 * this path's active request as an in-flow `review` block. Only the selection pill + instruction popup
 * (transient, anchored to a live text selection) stay floating — returned as `selectionOverlay`, which the
 * preview still drops on top of the scroll container. The diff + action box, the working "editing…" bar, and
 * the error card are all in `review`, woven into the document by `MarkdownPreview`.
 */
export function useMarkdownInlineEdit({
	containerRef,
	workspaceId,
	path,
	content,
}: {
	containerRef: React.RefObject<HTMLElement | null>;
	workspaceId: string;
	path: string;
	content: string;
}): { selectionOverlay: React.ReactNode; review: MarkdownReview | null } {
	const [target, setTarget] = useState<SelectionTarget | null>(null);
	const [popupOpen, setPopupOpen] = useState(false);
	const [popupError, setPopupError] = useState<string | null>(null);
	const [previewFor, setPreviewFor] = useState<string | null>(null);
	const [refineFor, setRefineFor] = useState<string | null>(null);

	// This path's active (not-done) request, if any.
	const request = useAppStore((s) =>
		Object.values(s.inlineEdits).find(
			(r) => r.workspaceId === workspaceId && r.path === path && r.status !== "done",
		),
	);

	// Capture selection changes inside the preview → show the pill (unless one edit is already pending here).
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const onSelect = () => {
			if (hasPendingEditForPath(workspaceId, path)) return;
			if (popupOpen) return;
			setTarget(resolveMarkdownSelection(el, { workspaceId, path }));
		};
		document.addEventListener("selectionchange", onSelect);
		return () => document.removeEventListener("selectionchange", onSelect);
	}, [containerRef, workspaceId, path, popupOpen]);

	// ⌘K opens the popup for the current selection.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && target) {
				e.preventDefault();
				setPopupOpen(true);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [target]);

	const submit = useCallback(
		async (instruction: string) => {
			if (!target) return;
			const captured = target;
			const id = await startInlineEdit(captured, instruction);
			if (id === null) {
				setPopupError("Couldn't start the edit — the session failed to open.");
				return;
			}
			setPopupOpen(false);
			setPopupError(null);
			setTarget(null);
		},
		[target],
	);

	// Build the selection overlay (pill → popup); this is the only part that stays floating.
	let selectionOverlay: React.ReactNode = null;
	if (popupOpen && target) {
		selectionOverlay = (
			<InstructionPopup
				rect={target.rect}
				error={popupError}
				onSubmit={submit}
				onCancel={() => {
					setPopupOpen(false);
					setPopupError(null);
				}}
			/>
		);
	} else if (target && !request) {
		selectionOverlay = <SelectionPill rect={target.rect} onClick={() => setPopupOpen(true)} />;
	}

	// The two floating children left (read-only preview popover, refine popup) anchor to their own in-flow
	// wrapper's rect — recomputed while open, on scroll/resize. No more container-wide block scanning: the
	// wrapper IS already positioned correctly by the split-render, so we only need its own bounding box.
	const workingRef = useRef<HTMLDivElement>(null);
	const reviewRef = useRef<HTMLDivElement>(null);
	const [previewRect, setPreviewRect] = useState<Rect | null>(null);
	const [refineRect, setRefineRect] = useState<Rect | null>(null);
	const previewOpen = !!request && previewFor === request.id;
	const refineOpen = !!request && refineFor === request.id;

	useLayoutEffect(() => {
		if (!previewOpen) return;
		const compute = () => {
			const r = workingRef.current?.getBoundingClientRect();
			if (r) setPreviewRect({ top: r.bottom + 4, left: r.left });
		};
		compute();
		window.addEventListener("resize", compute);
		window.addEventListener("scroll", compute, true);
		return () => {
			window.removeEventListener("resize", compute);
			window.removeEventListener("scroll", compute, true);
		};
	}, [previewOpen]);

	useLayoutEffect(() => {
		if (!refineOpen) return;
		const compute = () => {
			const r = reviewRef.current?.getBoundingClientRect();
			if (r) setRefineRect({ top: r.bottom + 4, left: r.left });
		};
		compute();
		window.addEventListener("resize", compute);
		window.addEventListener("scroll", compute, true);
		return () => {
			window.removeEventListener("resize", compute);
			window.removeEventListener("scroll", compute, true);
		};
	}, [refineOpen]);

	let review: MarkdownReview | null = null;
	if (request) {
		review = buildMarkdownReview({
			request,
			content,
			workingRef,
			reviewRef,
			previewOpen,
			previewRect,
			refineOpen,
			refineRect,
			onPreview: () => setPreviewFor((p) => (p === request.id ? null : request.id)),
			onClosePreview: () => setPreviewFor(null),
			onOpenInTab: () => openInlineEditInTab(request.id),
			onStop: () => void stopInlineEdit(request.id),
			onKeep: () => keepInlineEdit(request.id),
			onUndoLast: async () => {
				const res = await undoLastChange(request.id);
				if (!res.ok) console.warn("undo failed:", res.reason); // TODO(toast): surface via a toast primitive
			},
			onRevertAll: async () => {
				const res = await revertAll(request.id);
				if (!res.ok) console.warn("revert-all failed:", res.reason); // TODO(toast): surface via a toast primitive
			},
			onRefineOpen: () => setRefineFor(request.id),
			onRefineSubmit: (c) => {
				void refineInlineEdit(request.id, c);
				setRefineFor(null);
			},
			onRefineCancel: () => setRefineFor(null),
			onOpenChanges: () => useAppStore.getState().requestChangesView(workspaceId, request.path),
		});
	}

	return { selectionOverlay, review };
}

/**
 * Describe one request's in-flow review block: working chip / woven-diff+action-box / error card, by status.
 * `content` is the file's CURRENT (pre- or post-edit, per status) content — used only to locate the changed
 * region; the node itself is built from the request/turn data, matching today's behavior exactly.
 */
function buildMarkdownReview(props: {
	request: InlineEditRequest;
	content: string;
	workingRef: React.RefObject<HTMLDivElement | null>;
	reviewRef: React.RefObject<HTMLDivElement | null>;
	previewOpen: boolean;
	previewRect: Rect | null;
	refineOpen: boolean;
	refineRect: Rect | null;
	onPreview: () => void;
	onClosePreview: () => void;
	onOpenInTab: () => void;
	onStop: () => void;
	onKeep: () => void;
	onUndoLast: () => void;
	onRevertAll: () => void;
	onRefineOpen: () => void;
	onRefineSubmit: (comment: string) => void;
	onRefineCancel: () => void;
	onOpenChanges: () => void;
}): MarkdownReview {
	const { request } = props;

	if (request.status === "working" || request.status === "starting") {
		// Selection lines were captured against the stripped rendered doc (the anchor plugin stamps stripped
		// lines) — no frontmatter re-offset needed; they're already relative to what MarkdownPreview slices.
		return {
			mode: "insert",
			range: { start: request.selection.startLine, end: request.selection.endLine },
			node: (
				<div ref={props.workingRef} className="my-md">
					<EditStatusChip
						label="editing…"
						onPreview={props.onPreview}
						onOpenInTab={props.onOpenInTab}
						onStop={props.onStop}
					/>
					{props.previewOpen && props.previewRect ? (
						<PreviewPopover
							sessionId={request.sessionId}
							rect={props.previewRect}
							onClose={props.onClosePreview}
							onOpenInTab={props.onOpenInTab}
						/>
					) : null}
				</div>
			),
		};
	}

	if (request.status === "error") {
		return {
			mode: "insert",
			range: { start: request.selection.startLine, end: request.selection.endLine },
			node: (
				<div
					className="my-md rounded-[var(--radius-md)] border border-red/40 bg-elevated p-sm text-xs shadow-[var(--shadow-lg)]"
					data-testid="inline-edit-error"
				>
					<p className="text-red">{request.error ?? "The edit failed."}</p>
					<div className="mt-xs flex gap-xs">
						<button
							type="button"
							data-testid="inline-edit-error-refine"
							onClick={props.onRefineOpen}
							className="rounded-[var(--radius-sm)] border border-border2 px-sm py-0.5 text-text hover:bg-hover"
						>
							Retry…
						</button>
						<button
							type="button"
							data-testid="inline-edit-error-dismiss"
							onClick={props.onKeep}
							className="rounded-[var(--radius-sm)] border border-border2 px-sm py-0.5 text-text hover:bg-hover"
						>
							Dismiss
						</button>
						<button
							type="button"
							data-testid="inline-edit-error-open"
							onClick={props.onOpenInTab}
							className="rounded-[var(--radius-sm)] border border-border2 px-sm py-0.5 text-text hover:bg-hover"
						>
							Open as chat
						</button>
					</div>
				</div>
			),
		};
	}

	// review (or reverting): the woven diff (or a "no changes" card) + action bar, replacing the changed lines.
	// `why` is dropped (not set-to-undefined) — `EditActionBar`'s `why?: string` is exact-optional.
	const turn = request.turns.at(-1);
	const hunk = turn?.hunks.find((h) => h.path === request.path);
	// `request.afterContent` (set once the post-turn readback lands) gates readiness; the actual "after" text
	// is `props.content` — the SAME string `MarkdownPreview` is about to slice this render, so the range and
	// the slice never disagree even if the store field lags a render behind the prop.
	const range =
		request.afterContent !== undefined
			? changedLineRange(stripFrontmatter(turn?.baseContent ?? ""), stripFrontmatter(props.content))
			: null;

	const actionBar = (
		<EditActionBar
			{...(turn?.why !== undefined ? { why: turn.why } : {})}
			otherPaths={turn?.otherPaths ?? []}
			busy={request.status === "reverting"}
			turnIndex={request.turns.length}
			turnCount={request.turns.length}
			onKeep={props.onKeep}
			onUndoLast={props.onUndoLast}
			onRevertAll={props.onRevertAll}
			onRefine={props.onRefineOpen}
			onOpenInTab={props.onOpenInTab}
			onOpenChanges={props.onOpenChanges}
		/>
	);

	return {
		mode: "replace",
		range,
		node: (
			<div ref={props.reviewRef}>
				{hunk ? (
					<InlineSuggestion oldText={hunk.oldText} newText={hunk.newText}>
						{actionBar}
					</InlineSuggestion>
				) : (
					<div
						data-testid="inline-edit-nochanges"
						className="my-md rounded-[var(--radius-md)] border border-border2 bg-elevated p-sm text-xs shadow-[var(--shadow-lg)]"
					>
						<p className="text-muted">✦ {turn?.why || "The agent didn't change this file."}</p>
						{actionBar}
					</div>
				)}
				{props.refineOpen && props.refineRect ? (
					<InstructionPopup
						rect={props.refineRect}
						onSubmit={props.onRefineSubmit}
						onCancel={props.onRefineCancel}
					/>
				) : null}
			</div>
		),
	};
}
