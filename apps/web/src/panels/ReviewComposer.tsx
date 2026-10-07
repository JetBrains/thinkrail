import { cn } from "@thinkrail/ui/utils";
import { useEffect, useRef, useState } from "react";
import type { AnchorDraft, SurfaceReview } from "@/resources";
import {
	type ReviewTextBinding,
	reviewTextState,
	selectedReviewText,
} from "./resources/reviewDraftState";

function grow(el: HTMLTextAreaElement): void {
	el.style.height = "auto";
	el.style.height = `${Math.min(160, Math.max(56, el.scrollHeight + 2))}px`;
}

export function ReviewComposer({
	draft,
	label,
	commenting,
	initialText = "",
	input,
	notice,
	onClose,
	className,
}: {
	draft: AnchorDraft;
	label: string;
	commenting: SurfaceReview["commenting"];
	initialText?: string;
	input?: ReviewTextBinding | undefined;
	notice?: string;
	onClose: () => void;
	className?: string;
}) {
	const [initial] = useState(() => ({
		value: input?.value ?? reviewTextState(initialText),
		restored: input?.restored === true || input?.value !== undefined,
	}));
	const [local, setLocal] = useState(initial.value);
	const state = input?.value ?? local;
	const { text, busy } = state;
	const setInput = input?.onChange ?? setLocal;
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		const element = inputRef.current;
		if (!element) return;
		if (!initial.restored) element.focus();
		element.setSelectionRange(initial.value.start, initial.value.end, initial.value.direction);
		grow(element);
	}, [initial]);
	useEffect(() => {
		if (input && !input.value) input.onChange(initial.value);
	}, [initial, input]);

	const submit = (action: SurfaceReview["commenting"]["onSave"]) => {
		const body = text.trim();
		if (busy || !body) return;
		setInput({ ...state, busy: true });
		action(draft, body).then(onClose, () => setInput({ ...state, busy: false }));
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
					setInput(selectedReviewText(event.currentTarget, state));
					grow(event.currentTarget);
				}}
				onSelect={(event) => {
					const next = selectedReviewText(event.currentTarget, state);
					if (next !== state) setInput(next);
				}}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.key === "Escape") onClose();
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
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
