import { useCallback, useEffect, useState } from "react";
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
import { InstructionPopup } from "./InstructionPopup";
import { PreviewPopover } from "./PreviewPopover";
import { SelectionPill } from "./SelectionPill";
import { SuggestionOverlay } from "./SuggestionOverlay";
import type { InlineEditRequest, SelectionTarget } from "./types";

/**
 * Controller for inline editing in the rendered-markdown view. Owns selection→pill→popup→fire and renders
 * this path's working chip / review overlay / preview popover. Returns a single `overlay` node the preview
 * drops in (fixed-positioned children escape the scroll container).
 */
export function useMarkdownInlineEdit({
	containerRef,
	workspaceId,
	path,
}: {
	containerRef: React.RefObject<HTMLElement | null>;
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

	// Build the overlay node (pill → popup → chip/review/preview by status).
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

	// Working chip / review overlay for this path's request, anchored over the matched block.
	const requestOverlay = request ? (
		<MarkdownRequestOverlay
			containerRef={containerRef}
			request={request}
			previewOpen={previewFor === request.id}
			refineOpen={refineFor === request.id}
			onPreview={() => setPreviewFor((p) => (p === request.id ? null : request.id))}
			onClosePreview={() => setPreviewFor(null)}
			onOpenInTab={() => openInlineEditInTab(request.id)}
			onStop={() => void stopInlineEdit(request.id)}
			onKeep={() => keepInlineEdit(request.id)}
			onUndoLast={async () => {
				const res = await undoLastChange(request.id);
				if (!res.ok) console.warn("undo failed:", res.reason); // TODO(toast): surface via a toast primitive
			}}
			onRevertAll={async () => {
				const res = await revertAll(request.id);
				if (!res.ok) console.warn("revert-all failed:", res.reason); // TODO(toast): surface via a toast primitive
			}}
			onRefineOpen={() => setRefineFor(request.id)}
			onRefineSubmit={(c) => {
				void refineInlineEdit(request.id, c);
				setRefineFor(null);
			}}
			onRefineCancel={() => setRefineFor(null)}
			onOpenChanges={() => useAppStore.getState().requestChangesView(workspaceId, request.path)}
		/>
	) : null;

	return {
		overlay: (
			<>
				{overlay}
				{requestOverlay}
			</>
		),
	};
}

/**
 * Position the working chip / review overlay for one request. Anchor: the stamped block whose source lines
 * contain the request's selection (`[data-md-line-start]` ≤ startLine ≤ `[data-md-line-end]`). We track that
 * block's viewport rect and reposition on scroll/resize. If no block matches, we pin a fallback card to the
 * top of the preview (the review is never lost).
 */
function MarkdownRequestOverlay(props: {
	containerRef: React.RefObject<HTMLElement | null>;
	request: InlineEditRequest;
	previewOpen: boolean;
	refineOpen: boolean;
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
}) {
	const { containerRef, request } = props;
	const [rect, setRect] = useState<{ top: number; left: number } | null>(null);

	// `request.status` isn't read in `compute`, but a status change resizes/repositions the rendered card
	// (chip → review), so it's a recompute trigger.
	// biome-ignore lint/correctness/useExhaustiveDependencies: status is a recompute trigger, not read directly
	useEffect(() => {
		const compute = () => {
			const root = containerRef.current;
			if (!root) return;
			const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-md-line-start]"));
			const block = blocks.find((b) => {
				const s = Number(b.getAttribute("data-md-line-start"));
				const e = Number(b.getAttribute("data-md-line-end"));
				return s <= request.selection.startLine && request.selection.startLine <= e;
			});
			const r = (block ?? root).getBoundingClientRect();
			setRect({ top: block ? r.top : r.top + 8, left: r.left });
		};
		compute();
		const root = containerRef.current;
		root?.addEventListener("scroll", compute, { passive: true });
		window.addEventListener("resize", compute);
		return () => {
			root?.removeEventListener("scroll", compute);
			window.removeEventListener("resize", compute);
		};
	}, [containerRef, request.selection.startLine, request.status]);

	if (!rect) return null;
	// The current turn under review — hunks/why/otherPaths are per-turn in the per-turn model.
	const turn = request.turns.at(-1);
	const targetHunks = (turn?.hunks ?? []).filter((h) => h.path === request.path);
	const primary = targetHunks[0];

	if (request.status === "working" || request.status === "starting") {
		return (
			<>
				<div className="fixed z-40" style={{ top: rect.top, left: rect.left }}>
					<EditStatusChip
						label="editing…"
						onPreview={props.onPreview}
						onOpenInTab={props.onOpenInTab}
						onStop={props.onStop}
					/>
				</div>
				{props.previewOpen ? (
					<PreviewPopover
						sessionId={request.sessionId}
						rect={{ top: rect.top + 26, left: rect.left }}
						onClose={props.onClosePreview}
						onOpenInTab={props.onOpenInTab}
					/>
				) : null}
			</>
		);
	}

	if (request.status === "error") {
		return (
			<div
				className="fixed z-40 w-[360px] rounded-[var(--radius-md)] border border-red/40 bg-elevated p-sm text-xs shadow-[var(--shadow-lg)]"
				style={{ top: rect.top, left: rect.left }}
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
		);
	}

	// review (or reverting): the suggestion overlay (or a "no changes" card) + action bar.
	// `why` is dropped (not set-to-undefined) — `EditActionBar`'s `why?: string` is exact-optional.
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
	return (
		<>
			<div className="fixed z-40 w-[480px]" style={{ top: rect.top, left: rect.left }}>
				{primary ? (
					<SuggestionOverlay oldText={primary.oldText} newText={primary.newText}>
						{actionBar}
					</SuggestionOverlay>
				) : (
					<div
						data-testid="inline-edit-nochanges"
						className="rounded-[var(--radius-md)] border border-border2 bg-elevated p-sm text-xs shadow-[var(--shadow-lg)]"
					>
						<p className="text-muted">✦ {turn?.why || "The agent didn't change this file."}</p>
						{actionBar}
					</div>
				)}
			</div>
			{props.refineOpen ? (
				<InstructionPopup
					rect={{ top: rect.top + 30, left: rect.left }}
					onSubmit={props.onRefineSubmit}
					onCancel={props.onRefineCancel}
				/>
			) : null}
		</>
	);
}
