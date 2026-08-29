import { RiSendPlaneLine as Send, RiDeleteBin6Line as Trash2 } from "@remixicon/react";
import { useEffect, useRef, useState } from "react";
import { IconTooltip } from "../components/ui/tooltip";
import { threadLabel } from "./reviewModel";
import type { ReviewThreadActions, ReviewThreadData } from "./reviewWidgets";

function grow(el: HTMLTextAreaElement): void {
	el.style.height = "auto";
	el.style.height = `${el.scrollHeight}px`;
}

export function ReviewThreadCard({
	thread,
	actions,
}: {
	thread: ReviewThreadData;
	actions: ReviewThreadActions;
}) {
	const [busy, setBusy] = useState(false);
	const [draftText, setDraftText] = useState(thread.body);
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
	useEffect(() => {
		const el = editRef.current;
		if (el && el.value === draftText) grow(el);
	}, [draftText]);
	const saveEdit = () => {
		const next = draftText.trim();
		if (!next || next === thread.body) {
			setDraftText(thread.body);
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
				<span
					className={`review-thread-label tr-text-eyebrow${thread.refuted ? " text-text-subtle" : thread.stale ? " text-feedback-warning" : ""}`}
				>
					{threadLabel(thread)}
				</span>
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
						if (e.nativeEvent.isComposing) return;
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
