import { RiSendPlaneLine as Send, RiDeleteBin6Line as Trash2 } from "@remixicon/react";
import { useEffect, useRef, useState } from "react";
import { IconTooltip } from "../components/ui/tooltip";
import type { ReviewThread, ReviewThreadActions } from "../resources";
import { threadLabel } from "./reviewModel";

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
	const [busy, setBusy] = useState(false);
	const [draftText, setDraftText] = useState(thread.body);
	const [syncedBody, setSyncedBody] = useState(thread.body);
	if (syncedBody !== thread.body) {
		setSyncedBody(thread.body);
		if (draftText === syncedBody) setDraftText(thread.body);
	}
	const editRef = useRef<HTMLTextAreaElement>(null);
	const cancelledRef = useRef(false);
	const run = (action: (id: string) => Promise<void>) => {
		setBusy(true);
		action(thread.id).catch(() => setBusy(false));
	};
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
			setDraftText(thread.body);
			return;
		}
		actions.onUpdateComment(thread.id, next).catch(() => setDraftText(thread.body));
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
					>
						{threadLabel(thread)}
					</button>
				) : (
					<span
						className={`review-thread-label tr-text-eyebrow${thread.stale ? " text-feedback-warning" : ""}`}
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
								disabled={busy}
								onClick={() => run(actions.onSendComment)}
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
								onClick={() => run(actions.onDeleteComment)}
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
						setDraftText(e.target.value);
						grow(e.target);
					}}
					onBlur={saveEdit}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Escape") {
							cancelledRef.current = true;
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
