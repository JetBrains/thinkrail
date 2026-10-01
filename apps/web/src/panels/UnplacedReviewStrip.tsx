import { useEffect, useMemo, useRef } from "react";
import {
	anchorLabel,
	isPlaceable,
	type ResourceIntent,
	type ResourceRenderer,
	type SurfaceReview,
} from "@/resources";
import { ReviewThreadCard } from "./ReviewThreadCard";

export function UnplacedReviewStrip({
	reviews,
	renderer,
	intent,
	candidates,
	onSelectRenderer,
}: {
	reviews: readonly SurfaceReview[];
	renderer: ResourceRenderer;
	intent: ResourceIntent;
	candidates: readonly ResourceRenderer[];
	onSelectRenderer: (rendererId: string) => void;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const entries = useMemo(
		() =>
			reviews.flatMap((review) =>
				review.threads
					.filter((thread) => !isPlaceable(renderer, intent, thread.anchor))
					.map((thread) => ({ review, thread })),
			),
		[reviews, renderer, intent],
	);
	const focus = entries.find(({ review, thread }) => review.focus?.id === thread.id);
	useEffect(() => {
		if (!focus) return;
		const card = [
			...(rootRef.current?.querySelectorAll<HTMLElement>("[data-comment-id]") ?? []),
		].find((element) => element.dataset.commentId === focus.thread.id);
		card?.scrollIntoView({ block: "center" });
		focus.review.onFocusHandled();
	}, [focus]);
	if (entries.length === 0) return null;

	return (
		<div
			ref={rootRef}
			data-testid="review-unplaced-strip"
			className="max-h-[40vh] shrink-0 overflow-auto border-border-default border-b bg-container-header-bg p-8"
		>
			<p className="px-4 tr-text-eyebrow text-text-muted">
				Comments not placed in {renderer.label}
			</p>
			{entries.map(({ review, thread }) => {
				const target = candidates.find(
					(candidate) =>
						candidate.id !== renderer.id && isPlaceable(candidate, intent, thread.anchor),
				);
				return (
					<div key={thread.id} className="relative pr-[2rem]">
						<span className="absolute top-8 right-4 tr-code-text text-text-subtle">
							{anchorLabel(thread.anchor)}
						</span>
						<ReviewThreadCard thread={thread} actions={review.actions} />
						{target ? (
							<button
								type="button"
								data-testid="review-show-in-renderer"
								className="ml-12 rounded-[var(--radius-sm)] px-8 py-4 tr-text-action text-primary hover:bg-control-bg-hovered"
								onClick={() => onSelectRenderer(target.id)}
							>
								Show in {target.label}
							</button>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
