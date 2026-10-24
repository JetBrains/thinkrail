import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useRef, useState } from "react";
import type { AnchorDraft, SurfaceReview } from "../registry";
import {
	type ReviewTextBinding,
	reviewTextState,
	selectedReviewText,
	useReviewText,
} from "../renderers/reviewDraftState";

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
	const t = useT();
	const stored = useReviewText(input);
	const [initial] = useState(() => ({
		value: stored ?? reviewTextState(initialText),
		restored: input?.restored === true || stored !== undefined,
	}));
	const [local, setLocal] = useState(initial.value);
	const state = stored ?? local;
	const { text, busy } = state;
	const setInput = input?.onChange ?? setLocal;
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		const element = inputRef.current;
		if (!element) return;
		element.setSelectionRange(initial.value.start, initial.value.end, initial.value.direction);
		grow(element);
		if (initial.restored) return;
		if (element.getClientRects().length > 0) {
			element.focus();
			return;
		}
		const rendered = new ResizeObserver(() => {
			if (element.getClientRects().length === 0) return;
			rendered.disconnect();
			grow(element);
			element.focus();
		});
		rendered.observe(element);
		return () => rendered.disconnect();
	}, [initial]);
	useEffect(() => {
		if (input && input.read() === undefined) input.onChange(initial.value);
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
				placeholder={t("review.composer.placeholder")}
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
					{t("review.composer.saveDraft")}
				</button>
				<button
					type="button"
					data-testid="review-composer-send"
					className="review-composer-btn review-composer-btn-primary tr-text-action"
					disabled={busy || !text.trim()}
					onClick={() => submit(commenting.onSend)}
				>
					{t("review.composer.sendNow")}
				</button>
				<button
					type="button"
					data-testid="review-composer-cancel"
					className="review-composer-btn review-composer-btn-quiet tr-text-action"
					onClick={onClose}
				>
					{t("common.cancel")}
				</button>
			</div>
		</div>
	);
}
