import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib";
import type { AnchorDraft, SurfaceReview } from "@/resources";

function grow(el: HTMLTextAreaElement): void {
	el.style.height = "auto";
	el.style.height = `${Math.min(160, Math.max(56, el.scrollHeight + 2))}px`;
}

export function ReviewComposer({
	draft,
	label,
	commenting,
	initialText = "",
	notice,
	onClose,
	className,
}: {
	draft: AnchorDraft;
	label: string;
	commenting: SurfaceReview["commenting"];
	initialText?: string;
	notice?: string;
	onClose: () => void;
	className?: string;
}) {
	const [text, setText] = useState(initialText);
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		input.focus();
		input.setSelectionRange(input.value.length, input.value.length);
		grow(input);
	}, []);

	const submit = (action: SurfaceReview["commenting"]["onSave"]) => {
		const body = text.trim();
		if (!body) return;
		setBusy(true);
		action(draft, body).then(onClose, () => setBusy(false));
	};

	return (
		<div data-testid="review-composer" className={cn("review-composer", className)}>
			<span className="review-composer-label tr-code-text">{label}</span>
			{notice ? <span className="tr-text-metadata text-text-muted">{notice}</span> : null}
			<textarea
				ref={inputRef}
				data-testid="review-composer-input"
				className="review-composer-input tr-text-ui"
				placeholder="Leave a review comment…"
				value={text}
				disabled={busy}
				onChange={(event) => {
					setText(event.target.value);
					grow(event.target);
				}}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.key === "Escape") onClose();
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						submit(commenting.onSave);
					}
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
					onClick={onClose}
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
