import { RiChatNewLine as MessageSquarePlus } from "@remixicon/react";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useEffect, useMemo, useRef } from "react";
import { anchorLabel, type ResourceViewProps, type ReviewThread } from "@/resources";
import { ReviewComposer } from "../../ReviewComposer";
import { ReviewThreadCard } from "../../ReviewThreadCard";
import { useScrollViewState } from "../../useScrollViewState";
import { contentStamp, useStampedComposer } from "../reviewComposerState";
import { StaleComposerNotice } from "../StaleComposerNotice";
import { NotebookCellBody } from "./NotebookOutputView";
import {
	type NotebookCell,
	notebookCellDraft,
	notebookCellOfAnchor,
	parseNotebook,
	placedNotebookThreadIds,
} from "./notebookModel";

const NO_THREADS: ReadonlySet<string> = new Set();

export default function NotebookView({
	resource,
	content,
	review,
	onPlacedThreadIds,
	viewState,
	onViewState,
}: ResourceViewProps) {
	const text = content.kind === "text" ? content.text : "";
	const document = useMemo(() => parseNotebook(text), [text]);
	const composer = useStampedComposer<NotebookCell>(contentStamp(content));
	const cellRefs = useRef(new Map<string, HTMLElement>());
	const handledFocusRef = useRef<string | null>(null);
	const { attach: attachScroller } = useScrollViewState<HTMLDivElement>(viewState, onViewState);
	const placed = useMemo(
		() => placedNotebookThreadIds(review?.threads ?? [], document),
		[document, review?.threads],
	);
	const threadsByCell = useMemo(() => {
		const result = new Map<string, ReviewThread[]>();
		if (!document) return result;
		for (const thread of review?.threads ?? []) {
			const cell = notebookCellOfAnchor(thread.anchor, document);
			if (!cell) continue;
			const entries = result.get(cell.ref) ?? [];
			entries.push(thread);
			result.set(cell.ref, entries);
		}
		return result;
	}, [document, review?.threads]);
	const focusId = review?.focus?.id ?? null;

	useEffect(() => {
		onPlacedThreadIds?.(placed);
		return () => onPlacedThreadIds?.(NO_THREADS);
	}, [onPlacedThreadIds, placed]);

	useEffect(() => {
		if (!focusId) {
			handledFocusRef.current = null;
			return;
		}
		if (handledFocusRef.current === focusId || !document || !placed.has(focusId)) return;
		const thread = review?.threads.find((candidate) => candidate.id === focusId);
		const cell = thread ? notebookCellOfAnchor(thread.anchor, document) : null;
		const element = cell ? cellRefs.current.get(cell.ref) : null;
		if (!element) return;
		handledFocusRef.current = focusId;
		element.scrollIntoView({ block: "center" });
		review?.onFocusHandled();
	}, [document, focusId, placed, review]);

	if (!document) return null;

	return (
		<div
			ref={attachScroller}
			data-testid="notebook-view"
			className="h-full overflow-auto bg-container-workspace-bg p-12"
		>
			<div className="mx-auto flex max-w-[1100px] flex-col gap-12">
				{document.cells.map((cell) => {
					const threads = threadsByCell.get(cell.ref) ?? [];
					const resolvedLabel = threads[0]
						? anchorLabel(threads[0].anchor, document.cellOrdinals)
						: undefined;
					const draft = notebookCellDraft(cell);
					const composing = composer.composing && composer.selection?.ref === cell.ref;
					return (
						<section
							key={`${cell.index}:${cell.ref}`}
							ref={(node) => {
								if (node) cellRefs.current.set(cell.ref, node);
								else cellRefs.current.delete(cell.ref);
							}}
							data-testid="notebook-cell"
							data-cell-ref={cell.ref}
							className="overflow-hidden rounded-[var(--radius-md)] border border-border-default bg-container-workspace-bg"
						>
							<div className="flex min-w-0">
								<div className="flex w-64 shrink-0 flex-col items-center gap-4 border-border-muted border-r bg-container-header-bg py-8 tr-code-text text-text-subtle">
									<span>
										{cell.type === "code" ? `[${cell.executionCount ?? " "}]` : cell.index + 1}
									</span>
									{review ? (
										<IconTooltip label={`Comment on cell ${cell.index + 1}`}>
											<button
												type="button"
												data-testid="notebook-comment-cell"
												aria-label={`Comment on cell ${cell.index + 1}`}
												className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
												onClick={() => composer.select(cell)}
											>
												<MessageSquarePlus className="size-14" />
											</button>
										</IconTooltip>
									) : null}
									{threads.length > 0 ? (
										<span
											title={resolvedLabel}
											className="flex size-20 items-center justify-center rounded-full bg-primary tr-text-metadata text-text-on-primary"
										>
											{threads.length}
										</span>
									) : null}
								</div>
								<NotebookCellBody cell={cell} language={document.language} resource={resource} />
							</div>
							{composing && review ? (
								<div className="border-border-muted border-t p-8">
									<ReviewComposer
										draft={draft}
										label={draft.label}
										commenting={review.commenting}
										onClose={composer.close}
									/>
								</div>
							) : null}
							{review && threads.length > 0 ? (
								<div className="flex flex-col gap-4 border-border-muted border-t p-4">
									{threads.map((thread) => (
										<ReviewThreadCard
											key={thread.id}
											thread={thread}
											actions={review.actions}
											onActivate={() =>
												cellRefs.current.get(cell.ref)?.scrollIntoView({ block: "center" })
											}
										/>
									))}
								</div>
							) : null}
						</section>
					);
				})}
				<StaleComposerNotice visible={composer.stale} />
			</div>
		</div>
	);
}
