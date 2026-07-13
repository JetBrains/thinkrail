import type * as monaco from "monaco-editor";
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
import { monacoSelectionTarget } from "./anchor";
import { EditActionBar } from "./EditActionBar";
import { EditStatusChip } from "./EditStatusChip";
import { InstructionPopup } from "./InstructionPopup";
import { MonacoReviewCard } from "./MonacoReviewCard";
import { PreviewPopover } from "./PreviewPopover";
import { SelectionPill } from "./SelectionPill";
import type { SelectionTarget } from "./types";

/**
 * Controller for inline editing in the Monaco source view. Owns selection→pill→popup→fire (driven by
 * Monaco's own selection events) and renders this path's working chip / review overlay (`MonacoReviewCard`,
 * the v0 caveat form — no in-text strikethrough yet) / preview popover. Returns a single `overlay` node the
 * editor host drops into its `relative` container (absolute-positioned children anchor to it).
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
	const [previewOpen, setPreviewOpen] = useState(false);
	const [refineOpen, setRefineOpen] = useState(false);

	// This path's active (not-done) request, if any.
	const request = useAppStore((s) =>
		Object.values(s.inlineEdits).find(
			(r) => r.workspaceId === workspaceId && r.path === path && r.status !== "done",
		),
	);

	// Capture selection changes inside the editor → show the pill (unless one edit is already pending
	// here, or the instruction popup is already open). ⌘K opens the popup for the current selection.
	useEffect(() => {
		if (!editor) return;
		const sub = editor.onDidChangeCursorSelection(() => {
			if (hasPendingEditForPath(workspaceId, path) || popupOpen) return;
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
	}, [editor, workspaceId, path, popupOpen]);

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

	// Build the overlay node (pill → popup by status).
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

	// Working chip / review overlay for this path's request, anchored inside the editor's relative container.
	let requestOverlay: React.ReactNode = null;
	if (request) {
		// The current turn under review — hunks/why/otherPaths are per-turn in the per-turn model.
		const turn = request.turns.at(-1);
		const targetHunks = (turn?.hunks ?? []).filter((h) => h.path === request.path);
		if (request.status === "working" || request.status === "starting") {
			requestOverlay = (
				<div className="absolute top-2 right-2 z-20">
					<EditStatusChip
						label="editing…"
						onPreview={() => setPreviewOpen((p) => !p)}
						onOpenInTab={() => openInlineEditInTab(request.id)}
						onStop={() => void stopInlineEdit(request.id)}
					/>
					{previewOpen ? (
						<PreviewPopover
							sessionId={request.sessionId}
							rect={{ top: 40, left: 8 }}
							onClose={() => setPreviewOpen(false)}
							onOpenInTab={() => openInlineEditInTab(request.id)}
						/>
					) : null}
				</div>
			);
		} else if (request.status === "review" || request.status === "reverting") {
			// `why` is dropped (not set-to-undefined) — `EditActionBar`'s `why?: string` is exact-optional.
			requestOverlay = (
				<>
					<MonacoReviewCard hunks={targetHunks}>
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
							onRefine={() => setRefineOpen(true)}
							onOpenInTab={() => openInlineEditInTab(request.id)}
							onOpenChanges={() =>
								useAppStore.getState().requestChangesView(workspaceId, request.path)
							}
						/>
					</MonacoReviewCard>
					{refineOpen ? (
						<InstructionPopup
							rect={{ top: 60, left: 8 }}
							onSubmit={(c) => {
								void refineInlineEdit(request.id, c);
								setRefineOpen(false);
							}}
							onCancel={() => setRefineOpen(false)}
						/>
					) : null}
				</>
			);
		}
	}

	return {
		overlay: (
			<>
				{overlay}
				{requestOverlay}
			</>
		),
	};
}
