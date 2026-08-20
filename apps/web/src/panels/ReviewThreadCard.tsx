import { Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReviewThreadActions, ReviewThreadData } from "./reviewWidgets";

/** Auto-size a textarea to its wrapped content (the in-place draft editor grows with typing). */
function grow(el: HTMLTextAreaElement): void {
	el.style.height = "auto";
	el.style.height = `${el.scrollHeight}px`;
}

/**
 * The in-flow review comment card (the inline-edit branch's action-box presentation, adopted for
 * comments): a box sitting IN the document flow directly below its anchor — spliced between markdown
 * segments in the preview, held by a Monaco view zone in source/diff — with a status-colored left bar
 * (violet = draft, blue = sent). A DRAFT's body is **editable in place** until it's sent (click in,
 * type; blur or Cmd/Ctrl+Enter saves, Esc reverts) and carries Send + Delete (DRAFT-only — once
 * sent, a comment is a record; no rollback anywhere in review); sent/outdated cards are
 * passive read-only markers. Wears the `.review-thread*` skin the Monaco DOM twin uses.
 */
export function ReviewThreadCard({
	thread,
	actions,
}: {
	thread: ReviewThreadData;
	actions: ReviewThreadActions;
}) {
	const [busy, setBusy] = useState(false);
	const [draftText, setDraftText] = useState(thread.body);
	// Reconcile the field with a `review.changed` push (another client editing this draft): adopt the
	// new body whenever the field is NOT dirty — an unsaved local edit in flight is kept (it's the
	// user's newest intent; their save then lands as the usual last-writer update). Render-time state
	// adjustment (react.dev "adjusting state when a prop changes"), keyed on the last body we synced.
	const [syncedBody, setSyncedBody] = useState(thread.body);
	if (syncedBody !== thread.body) {
		setSyncedBody(thread.body);
		if (draftText === syncedBody) setDraftText(thread.body);
	}
	const editRef = useRef<HTMLTextAreaElement>(null);
	const run = (action: (id: string) => Promise<void>) => {
		setBusy(true);
		action(thread.id).catch(() => setBusy(false));
	};
	// Auto-size on mount and on every programmatic body change (a push-adopted body never fires the
	// textarea's own change handler). Guarded on the committed value so the measurement always reads
	// the text it is sizing for.
	useEffect(() => {
		const el = editRef.current;
		if (el && el.value === draftText) grow(el);
	}, [draftText]);
	const saveEdit = () => {
		const next = draftText.trim();
		if (!next || next === thread.body) {
			setDraftText(thread.body); // empty/unchanged — revert, never delete from here
			return;
		}
		actions.onUpdateComment(thread.id, next).catch(() => setDraftText(thread.body));
	};
	return (
		<div
			data-testid="review-thread"
			data-comment-id={thread.id}
			data-status={thread.status}
			className="review-thread"
		>
			<div className="review-thread-head">
				<span
					className={`review-thread-dot rounded-full review-thread-dot-${thread.status === "sent" ? "sent" : "draft"}`}
				/>
				<span className="review-thread-label tr-text-eyebrow">
					{thread.anchorState === "outdated" ? `${thread.status} · outdated` : thread.status}
				</span>
				{thread.status === "draft" && (
					<span className="review-thread-actions">
						<button
							type="button"
							data-testid="review-thread-send"
							title="Send this comment to the file's review chat"
							aria-label="Send this comment to the file's review chat"
							className="review-thread-action"
							disabled={busy}
							onClick={() => run(actions.onSendComment)}
						>
							<Send className="size-3" />
						</button>
						<button
							type="button"
							data-testid="review-thread-delete"
							title="Delete draft"
							aria-label="Delete draft"
							className="review-thread-action"
							disabled={busy}
							onClick={() => run(actions.onDeleteComment)}
						>
							<Trash2 className="size-3" />
						</button>
					</span>
				)}
			</div>
			{thread.status === "draft" ? (
				// Editable in place until sent: click in, type; blur / Cmd+Enter saves, Esc reverts.
				<textarea
					ref={editRef}
					data-testid="review-thread-edit"
					className="review-thread-edit review-thread-body tr-text-ui"
					rows={1}
					wrap="soft"
					value={draftText}
					disabled={busy}
					onChange={(e) => {
						setDraftText(e.target.value);
						grow(e.target);
					}}
					onBlur={saveEdit}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							setDraftText(thread.body);
							editRef.current?.blur();
						}
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) editRef.current?.blur();
					}}
				/>
			) : (
				<p className="review-thread-body tr-text-ui">{thread.body}</p>
			)}
		</div>
	);
}
