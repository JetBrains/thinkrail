import { RiSendPlaneLine as Send, RiDeleteBin6Line as Trash2 } from "@remixicon/react";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useEffect, useRef, useState } from "react";
import type { ReviewThread, ReviewThreadActions } from "../resources";
import {
	type ReviewTextState,
	reviewTextState,
	selectedReviewText,
	useReviewDraftState,
} from "./resources/reviewDraftState";
import { outdatedReason, threadLabel } from "./reviewModel";

function grow(el: HTMLTextAreaElement): void {
	el.style.height = "auto";
	el.style.height = `${el.scrollHeight}px`;
}

export function ReviewThreadCard({
	thread,
	actions,
	onActivate,
}: {
	thread: ReviewThread;
	actions: ReviewThreadActions;
	onActivate?: (() => void) | undefined;
}) {
	const [edit, changeEdit] = useReviewDraftState<ReviewTextState | undefined>(
		`thread:${thread.id}`,
		undefined,
	);
	const draftText = edit?.text ?? thread.body;
	const textState = edit ?? reviewTextState(draftText);
	const busy = textState.busy;
	const [restored] = useState(edit);
	const editRef = useRef<HTMLTextAreaElement>(null);
	const cancelledRef = useRef(false);
	const run = (action: () => Promise<void>) => {
		if (busy) return;
		const pending = { ...textState, busy: true };
		changeEdit(() => pending);
		action().then(
			() => changeEdit((current) => (current === pending ? undefined : current)),
			() => changeEdit((current) => (current === pending ? { ...pending, busy: false } : current)),
		);
	};
	useEffect(() => {
		if (restored)
			editRef.current?.setSelectionRange(restored.start, restored.end, restored.direction);
	}, [restored]);
	useEffect(() => {
		if (edit && !edit.busy && (thread.status !== "draft" || edit.text === thread.body)) {
			changeEdit((current) => (current === edit ? undefined : current));
		}
	}, [changeEdit, edit, thread.body, thread.status]);
	useEffect(() => {
		const el = editRef.current;
		if (el && el.value === draftText) grow(el);
	}, [draftText]);
	const saveEdit = () => {
		if (cancelledRef.current) {
			cancelledRef.current = false;
			return;
		}
		const next = draftText.trim();
		if (!next || next === thread.body) {
			changeEdit(() => undefined);
			return;
		}
		run(() => actions.onUpdateComment(thread.id, next));
	};
	return (
		<div
			data-testid="review-thread-card"
			data-comment-id={thread.id}
			data-status={thread.status}
			className="review-thread"
		>
			<div className="review-thread-head">
				<span
					className={`review-thread-dot rounded-full review-thread-dot-${thread.status === "sent" ? "sent" : "draft"}`}
				/>
				{onActivate ? (
					<button
						type="button"
						data-testid="review-thread-anchor"
						className={`review-thread-label rounded-[var(--radius-sm)] tr-text-eyebrow outline-none focus-visible:ring-2 focus-visible:ring-primary${thread.stale ? " text-feedback-warning" : ""}`}
						onClick={onActivate}
						{...(thread.anchorState === "outdated" ? { title: outdatedReason(thread.anchor) } : {})}
					>
						{threadLabel(thread)}
					</button>
				) : (
					<span
						className={`review-thread-label tr-text-eyebrow${thread.stale ? " text-feedback-warning" : ""}`}
						{...(thread.anchorState === "outdated" ? { title: outdatedReason(thread.anchor) } : {})}
					>
						{threadLabel(thread)}
					</span>
				)}
				{thread.status === "draft" && (
					<span className="review-thread-actions">
						<IconTooltip label="Send this comment to the file's review chat" wrapTrigger>
							<button
								type="button"
								data-testid="review-thread-send"
								aria-label="Send this comment to the file's review chat"
								className="review-thread-action disabled:pointer-events-none"
								disabled={busy || !draftText.trim()}
								onClick={() =>
									run(async () => {
										if (draftText.trim() !== thread.body) {
											await actions.onUpdateComment(thread.id, draftText.trim());
										}
										await actions.onSendComment(thread.id);
									})
								}
							>
								<Send className="size-12" />
							</button>
						</IconTooltip>
						<IconTooltip label="Delete draft" wrapTrigger>
							<button
								type="button"
								data-testid="review-thread-delete"
								aria-label="Delete draft"
								className="review-thread-action disabled:pointer-events-none"
								disabled={busy}
								onClick={() => run(() => actions.onDeleteComment(thread.id))}
							>
								<Trash2 className="size-12" />
							</button>
						</IconTooltip>
					</span>
				)}
			</div>
			{thread.status === "draft" ? (
				<textarea
					ref={editRef}
					data-testid="review-thread-edit"
					className="review-thread-edit review-thread-body tr-text-ui"
					rows={1}
					wrap="soft"
					value={draftText}
					disabled={busy}
					onChange={(e) => {
						const next = selectedReviewText(e.currentTarget, textState);
						changeEdit(() => next);
						grow(e.currentTarget);
					}}
					onSelect={(e) => {
						const next = selectedReviewText(e.currentTarget, textState);
						if (next !== textState) changeEdit(() => next);
					}}
					onBlur={(event) => {
						if (event.currentTarget.parentElement?.contains(event.relatedTarget)) return;
						saveEdit();
					}}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Escape") {
							cancelledRef.current = true;
							changeEdit(() => undefined);
							editRef.current?.blur();
						}
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							editRef.current?.blur();
						}
					}}
				/>
			) : (
				<p className="review-thread-body tr-text-ui">{thread.body}</p>
			)}
		</div>
	);
}
