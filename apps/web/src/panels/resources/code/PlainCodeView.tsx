import { useEffect } from "react";
import { anchorLabel, type ResourceViewProps } from "@/resources";
import { CodeBlock } from "../../../chat/tools/CodeBlock";
import { ReviewThreadCard } from "../../ReviewThreadCard";
import { useScrollViewState } from "../../useScrollViewState";

export default function PlainCodeView({
	resource,
	content,
	review,
	viewState,
	onViewState,
}: ResourceViewProps) {
	const text = content.kind === "text" ? content.text : "";
	const threads =
		review?.threads.filter((thread) =>
			thread.anchor.selectors.some((selector) => selector.kind === "lineRange"),
		) ?? [];
	const { elementRef: rootRef, attach: attachScroller } = useScrollViewState<HTMLDivElement>(
		viewState,
		onViewState,
	);
	useEffect(() => {
		if (!review?.focus) return;
		const card = [
			...(rootRef.current?.querySelectorAll<HTMLElement>("[data-comment-id]") ?? []),
		].find((element) => element.dataset.commentId === review.focus?.id);
		if (card) {
			card.scrollIntoView({ block: "center" });
			review.onFocusHandled();
		}
	}, [review]);
	return (
		<div
			ref={attachScroller}
			data-testid="plain-code-view"
			className="h-full overflow-auto bg-container-workspace-bg p-12 [&_pre]:min-h-full [&_pre]:rounded-none [&_pre]:bg-container-workspace-bg"
		>
			<CodeBlock code={text} lang={resource.language ?? ""} />
			{review
				? threads.map((thread) => (
						<div key={thread.id}>
							<span className="ml-12 tr-code-text text-text-subtle">
								{anchorLabel(thread.anchor)}
							</span>
							<ReviewThreadCard thread={thread} actions={review.actions} />
						</div>
					))
				: null}
		</div>
	);
}
