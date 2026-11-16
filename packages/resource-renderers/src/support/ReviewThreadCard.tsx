import { RiSendPlaneLine as Send, RiDeleteBin6Line as Trash2 } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { useEffect, useRef, useState } from "react";
import type { ReviewThread, ReviewThreadActions } from "../registry";
import { outdatedReason, threadLabel } from "../registry";
import {
	type ReviewTextState,
	reviewTextState,
	selectedReviewText,
	useReviewDraftState,
} from "../renderers/reviewDraftState";
import { composerSubmit, useReviewSurfaceKeys } from "./cursorKeys";
import { focusBefore } from "./revealFocus";

function grow(el: HTMLTextAreaElement): void {
	el.style.height = "auto";
	el.style.height = `${el.scrollHeight}px`;
}

export function ReviewThreadCard({
	thread,
	actions,
	onActivate,
	onReturnFocus,
}: {
	thread: ReviewThread;
	actions: ReviewThreadActions;
	onActivate?: (() => void) | undefined;
	onReturnFocus?: ((from: HTMLElement) => void) | undefined;
}) {
	const t = useT();
	const keys = useReviewSurfaceKeys();
	const [edit, changeEdit] = useReviewDraftState<ReviewTextState | undefined>(
		`thread:${thread.id}`,
		undefined,
	);
	const draftText = edit?.text ?? thread.body;
	const textState = edit ?? reviewTextState(draftText);
	const busy = textState.busy;
	const [restored] = useState(edit);
	const cardRef = useRef<HTMLDivElement>(null);
	const editRef = useRef<HTMLTextAreaElement>(null);
	const skipBlurSaveRef = useRef(false);
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
	const returnFocus = () => {
		const card = cardRef.current;
		if (!card) return;
		skipBlurSaveRef.current = true;
		if (onReturnFocus) onReturnFocus(card);
		else focusBefore(card);
		skipBlurSaveRef.current = false;
	};
	const saveEdit = () => {
		if (skipBlurSaveRef.current) return;
		const next = draftText.trim();
		if (!next || next === thread.body) {
			changeEdit(() => undefined);
			return;
		}
		run(() => actions.onUpdateComment(thread.id, next));
	};
	return (
		<div
			ref={cardRef}
			data-testid="review-thread-card"
			data-comment-id={thread.id}
			data-focus-row={thread.id}
			data-status={thread.status}
			tabIndex={-1}
			className="review-thread focus-visible:focus-ring"
		>
			<div className="review-thread-head">
				<span
					className={`review-thread-dot rounded-full review-thread-dot-${thread.status === "sent" ? "sent" : "draft"}`}
				/>
				{onActivate ? (
					<button
						type="button"
						data-testid="review-thread-anchor"
						className={`review-thread-label rounded-sm tr-text-eyebrow focus-visible:focus-ring${thread.stale ? " text-feedback-warning" : ""}`}
						onClick={onActivate}
						{...(thread.anchorState === "outdated"
							? { title: outdatedReason(t, thread.anchor) }
							: {})}
					>
						{threadLabel(t, thread)}
					</button>
				) : (
					<span
						className={`review-thread-label tr-text-eyebrow${thread.stale ? " text-feedback-warning" : ""}`}
						{...(thread.anchorState === "outdated"
							? { title: outdatedReason(t, thread.anchor) }
							: {})}
					>
						{threadLabel(t, thread)}
					</span>
				)}
				{thread.status === "draft" && (
					<span className="review-thread-actions">
						<IconButton
							icon={Send}
							label={t("review.comment.send")}
							wrapTrigger
							size="s"
							data-testid="review-thread-send"
							disabled={busy || !draftText.trim()}
							onClick={() => {
								run(async () => {
									if (draftText.trim() !== thread.body) {
										await actions.onUpdateComment(thread.id, draftText.trim());
									}
									await actions.onSendComment(thread.id);
								});
								returnFocus();
							}}
						/>
						<IconButton
							icon={Trash2}
							label={t("review.comment.deleteDraft")}
							wrapTrigger
							size="s"
							data-testid="review-thread-delete"
							disabled={busy}
							onClick={() => {
								run(() => actions.onDeleteComment(thread.id));
								returnFocus();
							}}
						/>
					</span>
				)}
			</div>
			{thread.status === "draft" ? (
				<textarea
					ref={editRef}
					data-testid="review-thread-edit"
					data-focus-row-primary
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
						const card = event.currentTarget.parentElement;
						const next = event.relatedTarget;
						if (next !== card && card?.contains(next)) return;
						saveEdit();
					}}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (isImeComposing(e.nativeEvent)) return;
						if (e.key === "Escape") {
							changeEdit(() => undefined);
							returnFocus();
						}
						if (composerSubmit(e.nativeEvent, keys) === "save") {
							e.preventDefault();
							saveEdit();
							returnFocus();
						}
					}}
				/>
			) : (
				<p className="review-thread-body tr-text-ui">{thread.body}</p>
			)}
		</div>
	);
}
