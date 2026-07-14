import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { monacoSelectionTarget } from "./anchor";
import { EditActionBar } from "./EditActionBar";
import { EditStatusChip } from "./EditStatusChip";
import { InlineSuggestion } from "./InlineSuggestion";
import { InstructionPopup } from "./InstructionPopup";
import { changedLineRange } from "./lineDiff";
import { PreviewPopover } from "./PreviewPopover";
import { SelectionPill } from "./SelectionPill";
import type { SelectionTarget } from "./types";

/** A rect-anchored floating popover needs a viewport position — kept minimal, {top,left} only. */
type Rect = { top: number; left: number };

/**
 * Controller for inline editing in the Monaco source view. Owns selection→pill→popup→fire (driven by
 * Monaco's own selection events, unchanged) and renders this path's active request — the working chip /
 * woven-diff+action-box / error card — as a NATIVE Monaco view zone inserted between the lines, plus a
 * decoration highlighting the changed lines during review. Only the trigger (pill/popup) stays a floating
 * `overlay` the editor host drops into its `relative` container; the zone is a real DOM node Monaco lays
 * out inline in the buffer, populated by a React portal this hook creates and tears down itself — never a
 * floating card.
 */
export function useMonacoInlineEdit({
	editor,
	workspaceId,
	path,
}: {
	editor: monaco.editor.IStandaloneCodeEditor | null;
	workspaceId: string;
	path: string;
}) {
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

	// Selection listener reads live popup state via ref so the effect doesn't need `popupOpen` as a
	// dependency — `editor.addCommand` returns a plain id (not disposable), so re-running the effect on
	// every popup toggle would accumulate commands over the session.
	const popupOpenRef = useRef(popupOpen);
	popupOpenRef.current = popupOpen;

	// Capture selection changes inside the editor → show the pill (unless one edit is already pending
	// here, or the instruction popup is already open). ⌘K opens the popup for the current selection. This
	// trigger path is unchanged by the view-zone rework.
	useEffect(() => {
		if (!editor) return;
		const sub = editor.onDidChangeCursorSelection(() => {
			if (hasPendingEditForPath(workspaceId, path) || popupOpenRef.current) return;
			setTarget(monacoSelectionTarget(editor, { workspaceId, path }));
		});
		// 2048 | 41 = monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK. Numeric literals (not the enum) because
		// this controller keeps `monaco-editor` type-only — MonacoEditor.tsx owns the value import.
		const CTRL_CMD_K = 2048 /* CtrlCmd */ | 41; /* KeyK */
		const key = editor.addCommand(CTRL_CMD_K, () => setPopupOpen(true));
		return () => {
			sub.dispose();
			void key;
		};
	}, [editor, workspaceId, path]);

	const submit = useCallback(
		async (instruction: string) => {
			if (!target) return;
			const id = await startInlineEdit(target, instruction);
			if (id === null) {
				setPopupError("Couldn't start the edit.");
				return;
			}
			setPopupOpen(false);
			setPopupError(null);
			setTarget(null);
		},
		[target],
	);

	// Build the floating trigger overlay (pill → popup by status) — the only part that stays an
	// absolutely-positioned child of the editor host's `relative` container.
	let overlay: React.ReactNode = null;
	if (popupOpen && target) {
		overlay = (
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
		overlay = <SelectionPill rect={target.rect} onClick={() => setPopupOpen(true)} />;
	}

	// The turn under review and its target-file hunk — same reading as the markdown controller (`.at(-1)` /
	// `.find`), so the two surfaces stay in lockstep even though one splices into a DOM tree and the other
	// into Monaco's own.
	const turn = request?.turns.at(-1);
	const hunk = turn?.hunks.find((h) => h.path === request?.path);
	const previewOpen = !!request && previewFor === request.id;
	const refineOpen = !!request && refineFor === request.id;

	// The changed-line range in the BUFFER — raw content, no frontmatter-stripping (Monaco shows the raw file).
	// Read from `request.afterContent`, the post-turn readback the orchestrator stores from the SAME file tab
	// that drives Monaco's model, so the range matches what's on screen. Using the reactive store field (not a
	// `getModel().getValue()` call in the render body) keeps this out of the render path AND makes it recompute
	// when the readback lands — a raw model read wouldn't re-render on change. Only meaningful during
	// review/reverting; `null` before the readback lands or when the turn changed nothing in this file.
	const afterContent =
		request && (request.status === "review" || request.status === "reverting")
			? request.afterContent
			: undefined;
	const changedRange = useMemo(
		() =>
			afterContent !== undefined ? changedLineRange(turn?.baseContent ?? "", afterContent) : null,
		[afterContent, turn?.baseContent],
	);
	// Beyond the line range, "what the zone should show" can change without the range changing (e.g. a
	// refine that happens to land on the same lines still needs its diff/why text rebuilt) — this identity
	// forces the zone effect to rerun (and thus remeasure) in that case too.
	const turnHunkIdentity = turn
		? `${request?.turns.length}:${hunk?.oldText ?? ""}:${hunk?.newText ?? ""}:${turn.why ?? ""}`
		: null;

	// The view zone's DOM node — Monaco-owned, created/attached by the effect below; `null` whenever there's
	// no active zone (no request, or between zone recreations). The render body portals `zoneContent` into
	// it; it never renders through the `relative` overlay container.
	const [zoneNode, setZoneNode] = useState<HTMLDivElement | null>(null);

	// Live handle to the current zone (its Monaco object, id, and inner content node), so both the async
	// ResizeObserver and the synchronous first-paint layout effect below can size it without re-deriving any
	// of them. `null` while no zone exists; set/cleared in lockstep with the creation effect.
	const zoneRef = useRef<{
		zone: monaco.editor.IViewZone;
		id: string;
		content: HTMLDivElement;
	} | null>(null);

	// Measure the current zone's inner content node and re-layout the zone if its height drifted (>1px). Shared
	// by the ResizeObserver (post-paint content changes) and the synchronous first-paint layout effect. No-op
	// when there's no zone or the editor is gone.
	const sizeZoneToContent = useCallback(() => {
		const z = zoneRef.current;
		if (!editor || !z) return;
		const h = Math.ceil(z.content.getBoundingClientRect().height);
		if (h > 0 && Math.abs((z.zone.heightInPx ?? 0) - h) > 1) {
			z.zone.heightInPx = h;
			editor.changeViewZones((accessor) => accessor.layoutZone(z.id));
		}
	}, [editor]);

	// Hoisted out of `request` so the effect below closes over plain primitives, not property reads on the
	// request object — keeps its dependency list narrow (recreate the zone only when THESE change, not on
	// every unrelated field mutation the store folds into `request`).
	const requestStatus = request?.status;
	const selectionStartLine = request?.selection.startLine;

	// Manage the view zone + decoration as native Monaco state — created/torn down here, never re-derived
	// from React's render output. At most one zone at a time (the three statuses that render one are
	// mutually exclusive): positioned after the changed range in review, or after the selection's start line
	// while working/erroring.
	useLayoutEffect(() => {
		if (!editor || !requestStatus || selectionStartLine === undefined) return undefined;
		// `turnHunkIdentity` isn't read below — it's a dependency only, forcing a rebuild when a refine lands
		// on the same lines but changes the diff/why text (see its definition above).
		void turnHunkIdentity;
		const model = editor.getModel();
		if (!model) return undefined;
		const lineCount = Math.max(1, model.getLineCount());

		let afterLine: number;
		let decoRange: { start: number; end: number } | null = null;
		if (requestStatus === "review" || requestStatus === "reverting") {
			afterLine = Math.min(changedRange?.end ?? selectionStartLine, lineCount);
			decoRange = changedRange;
		} else if (
			requestStatus === "working" ||
			requestStatus === "starting" ||
			requestStatus === "error"
		) {
			afterLine = Math.min(selectionStartLine, lineCount);
		} else {
			return undefined; // "done" — the selector above already excludes it; belt-and-suspenders guard.
		}

		// Monaco sets the zone's OUTER domNode height to the zone's `heightInPx` (with overflow visible), so
		// measuring that node feeds back a stuck value AND its box never changes size — a ResizeObserver on it
		// never fires. We therefore portal the content into an INNER, naturally-sized node and observe THAT;
		// its real height drives the zone height so nothing clips or overlaps the buffer below.
		const domNode = document.createElement("div");
		const contentNode = document.createElement("div");
		domNode.appendChild(contentNode);
		const zone: monaco.editor.IViewZone = { afterLineNumber: afterLine, heightInPx: 1, domNode };
		let zoneId = "";
		editor.changeViewZones((accessor) => {
			zoneId = accessor.addZone(zone);
		});
		const decorations = editor.createDecorationsCollection(
			decoRange
				? [
						{
							range: {
								startLineNumber: decoRange.start,
								startColumn: 1,
								endLineNumber: decoRange.end,
								endColumn: 1,
							},
							options: { isWholeLine: true, className: "inline-edit-changed-line" },
						},
					]
				: [],
		);
		zoneRef.current = { zone, id: zoneId, content: contentNode };
		setZoneNode(contentNode);

		// The zone's height is content-driven (the diff + action box, the chip, or the error card) — remeasure
		// and re-layout whenever the portaled content resizes AFTER paint (async growth, image/font load, a
		// popover the content reflows around). The FIRST paint is handled synchronously by the layout effect
		// below, so a fresh zone never shows at its seed 1px for a painted frame with content overlapping the
		// lines beneath it.
		const ro = new ResizeObserver(() => sizeZoneToContent());
		ro.observe(contentNode);

		return () => {
			ro.disconnect();
			try {
				editor.changeViewZones((accessor) => accessor.removeZone(zoneId));
			} catch {
				// The editor may already be disposed (e.g. the tab closed mid-transition) — nothing left to clean up.
			}
			decorations.clear();
			zoneRef.current = null;
			setZoneNode(null);
		};
	}, [
		editor,
		requestStatus,
		selectionStartLine,
		turnHunkIdentity,
		changedRange,
		sizeZoneToContent,
	]);

	// Size a freshly-created zone to its content synchronously after the portal commits but BEFORE the browser
	// paints. The creation effect seeds the zone at 1px (content height is unknown until the portal renders),
	// and the ResizeObserver only fires asynchronously — so without this the zone would show at 1px for one
	// painted frame, its content spilling over the lines below, then snap open. Keyed on `zoneNode`: a new
	// inner node means a new, not-yet-measured zone.
	useLayoutEffect(() => {
		if (!zoneNode) return;
		sizeZoneToContent();
	}, [sizeZoneToContent, zoneNode]);

	// The read-only preview popover (working) / refine popup (review, error) anchor to the zone's own rect —
	// recomputed while open, on scroll/resize (mirrors the markdown controller's in-flow anchoring; the zone
	// node here plays the role its in-flow wrapper refs play there).
	const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
	const anchorOpen = previewOpen || refineOpen;
	useLayoutEffect(() => {
		if (!zoneNode || !anchorOpen) return undefined;
		const compute = () => {
			const r = zoneNode.getBoundingClientRect();
			setAnchorRect({ top: r.bottom + 4, left: r.left });
		};
		compute();
		window.addEventListener("resize", compute);
		window.addEventListener("scroll", compute, true);
		return () => {
			window.removeEventListener("resize", compute);
			window.removeEventListener("scroll", compute, true);
		};
	}, [zoneNode, anchorOpen]);

	// Build the zone's content for the current status — portaled into `zoneNode` (Monaco's own DOM), never a
	// floating card. `why` is dropped (not set-to-undefined) — `EditActionBar`'s `why?: string` is
	// exact-optional.
	let zoneContent: React.ReactNode = null;
	if (request && zoneNode) {
		if (request.status === "working" || request.status === "starting") {
			zoneContent = (
				<div className="px-sm py-xs">
					<EditStatusChip
						label="editing…"
						onPreview={() => setPreviewFor((p) => (p === request.id ? null : request.id))}
						onOpenInTab={() => openInlineEditInTab(request.id)}
						onStop={() => void stopInlineEdit(request.id)}
					/>
					{previewOpen && anchorRect ? (
						<PreviewPopover
							sessionId={request.sessionId}
							rect={anchorRect}
							onClose={() => setPreviewFor(null)}
							onOpenInTab={() => openInlineEditInTab(request.id)}
						/>
					) : null}
				</div>
			);
		} else if (request.status === "review" || request.status === "reverting") {
			const actionBar = (
				<EditActionBar
					{...(turn?.why !== undefined ? { why: turn.why } : {})}
					otherPaths={turn?.otherPaths ?? []}
					busy={request.status === "reverting"}
					turnIndex={request.turns.length}
					turnCount={request.turns.length}
					onKeep={() => keepInlineEdit(request.id)}
					onUndoLast={async () => {
						const r = await undoLastChange(request.id);
						if (!r.ok) console.warn("undo:", r.reason); // TODO(toast): surface via a toast primitive
					}}
					onRevertAll={async () => {
						const r = await revertAll(request.id);
						if (!r.ok) console.warn("revert-all:", r.reason); // TODO(toast): surface via a toast primitive
					}}
					onRefine={() => setRefineFor(request.id)}
					onOpenInTab={() => openInlineEditInTab(request.id)}
					onOpenChanges={() => useAppStore.getState().requestChangesView(workspaceId, request.path)}
				/>
			);
			zoneContent = (
				<div data-testid="inline-edit-monaco-zone" className="px-sm py-xs">
					{hunk ? (
						<>
							{/* Woven diff, then the action box as a distinct between-lines widget directly below. */}
							<InlineSuggestion oldText={hunk.oldText} newText={hunk.newText} />
							<div className="rounded border border-primary/30 bg-elevated px-sm py-xs">
								{actionBar}
							</div>
						</>
					) : (
						<div
							data-testid="inline-edit-nochanges"
							className="rounded-[var(--radius-md)] border border-border2 bg-elevated p-sm text-xs shadow-[var(--shadow-lg)]"
						>
							<p className="text-muted">✦ {turn?.why || "The agent didn't change this file."}</p>
							{actionBar}
						</div>
					)}
					{refineOpen && anchorRect ? (
						<InstructionPopup
							rect={anchorRect}
							onSubmit={(c) => {
								void refineInlineEdit(request.id, c);
								setRefineFor(null);
							}}
							onCancel={() => setRefineFor(null)}
						/>
					) : null}
				</div>
			);
		} else if (request.status === "error") {
			zoneContent = (
				<div className="px-sm py-xs">
					<div
						data-testid="inline-edit-error"
						className="rounded-[var(--radius-md)] border border-red/40 bg-elevated p-sm text-xs shadow-[var(--shadow-lg)]"
					>
						<p className="text-red">{request.error ?? "The edit failed."}</p>
						<div className="mt-xs flex gap-xs">
							<button
								type="button"
								data-testid="inline-edit-error-refine"
								onClick={() => setRefineFor(request.id)}
								className="rounded-[var(--radius-sm)] border border-border2 px-sm py-0.5 text-text hover:bg-hover"
							>
								Retry…
							</button>
							<button
								type="button"
								data-testid="inline-edit-error-dismiss"
								onClick={() => keepInlineEdit(request.id)}
								className="rounded-[var(--radius-sm)] border border-border2 px-sm py-0.5 text-text hover:bg-hover"
							>
								Dismiss
							</button>
							<button
								type="button"
								data-testid="inline-edit-error-open"
								onClick={() => openInlineEditInTab(request.id)}
								className="rounded-[var(--radius-sm)] border border-border2 px-sm py-0.5 text-text hover:bg-hover"
							>
								Open as chat
							</button>
						</div>
					</div>
					{refineOpen && anchorRect ? (
						<InstructionPopup
							rect={anchorRect}
							onSubmit={(c) => {
								void refineInlineEdit(request.id, c);
								setRefineFor(null);
							}}
							onCancel={() => setRefineFor(null)}
						/>
					) : null}
				</div>
			);
		}
	}

	return {
		overlay: (
			<>
				{overlay}
				{zoneNode ? createPortal(zoneContent, zoneNode) : null}
			</>
		),
	};
}
