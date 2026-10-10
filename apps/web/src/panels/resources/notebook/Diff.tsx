import { RiChatNewLine as MessageSquarePlus } from "@remixicon/react";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useEffect, useMemo, useRef } from "react";
import type { ResourceDiffProps, ReviewThread, SurfaceReview } from "@/resources";
import { ReviewComposer } from "../../ReviewComposer";
import { ReviewThreadCard } from "../../ReviewThreadCard";
import { useScrollViewState } from "../../useScrollViewState";
import PierreProvider from "../code/PierreProvider";
import { diffContentStamp, useStampedComposer } from "../reviewComposerState";
import { StaleComposerNotice } from "../StaleComposerNotice";
import { NotebookOutputsDiff, NotebookSourceDiff } from "./NotebookCellDiff";
import { NotebookCellBody, NotebookOutputs } from "./NotebookOutputView";
import {
	type AlignedNotebookCell,
	alignNotebookCells,
	type NotebookCell,
	notebookCellDraft,
	notebookCellOfAnchor,
	parseNotebook,
	placedNotebookThreadIds,
} from "./notebookModel";

const NO_THREADS: ReadonlySet<string> = new Set();
type Side = "base" | "worktree";

interface SelectedCell {
	cell: NotebookCell;
	side: Side;
}

interface ThreadEntry {
	thread: ReviewThread;
	side: Side;
}

function entryKey(entry: AlignedNotebookCell): string {
	if (entry.state === "added") return `added:${entry.modified.index}:${entry.modified.ref}`;
	if (entry.state === "removed") return `removed:${entry.original.index}:${entry.original.ref}`;
	return `${entry.state}:${entry.original.index}:${entry.modified.index}:${entry.modified.ref}`;
}

function stateClass(state: AlignedNotebookCell["state"]): string {
	if (state === "added") return "border-feedback-success bg-feedback-success-subtle";
	if (state === "removed") return "border-feedback-error bg-feedback-error-subtle";
	if (state === "changed") return "border-feedback-info bg-feedback-info-subtle";
	return "border-border-default bg-container-content-bg";
}

function sourceLanguage(cell: NotebookCell, notebookLanguage: string): string | undefined {
	if (cell.type === "code") return notebookLanguage;
	if (cell.type === "markdown") return "markdown";
	return undefined;
}

function entryCells(entry: AlignedNotebookCell): {
	original: NotebookCell | null;
	modified: NotebookCell | null;
} {
	if (entry.state === "added") return { original: null, modified: entry.modified };
	if (entry.state === "removed") return { original: entry.original, modified: null };
	return { original: entry.original, modified: entry.modified };
}

function CellCommentButton({
	cell,
	side,
	onSelect,
}: {
	cell: NotebookCell;
	side: Side;
	onSelect: (selection: SelectedCell) => void;
}) {
	const label = `Comment on ${side === "base" ? "old" : "new"} cell ${cell.index + 1}`;
	return (
		<IconTooltip label={label}>
			<button
				type="button"
				aria-label={label}
				data-testid={`notebook-comment-cell-${side}`}
				className="flex size-24 items-center justify-center rounded-sm text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
				onClick={() => onSelect({ cell, side })}
			>
				<MessageSquarePlus className="size-14" />
			</button>
		</IconTooltip>
	);
}

function NotebookDiffSurface({
	resource,
	original,
	modified,
	ignoreWhitespace,
	review,
	onPlacedThreadIds,
	viewState,
	onViewState,
}: ResourceDiffProps) {
	const originalText = original.kind === "text" ? original.text : null;
	const modifiedText = modified.kind === "text" ? modified.text : null;
	const originalDocument = useMemo(
		() => (originalText === null ? null : parseNotebook(originalText)),
		[originalText],
	);
	const modifiedDocument = useMemo(
		() => (modifiedText === null ? null : parseNotebook(modifiedText)),
		[modifiedText],
	);
	const aligned = useMemo(
		() => alignNotebookCells(originalDocument?.cells ?? [], modifiedDocument?.cells ?? []),
		[modifiedDocument, originalDocument],
	);
	const stamp = diffContentStamp(original, modified);
	const composer = useStampedComposer<SelectedCell>(stamp);
	const cellRefs = useRef(new Map<string, HTMLElement>());
	const handledFocusRef = useRef<string | null>(null);
	const { attach: attachScroller } = useScrollViewState<HTMLDivElement>(viewState, onViewState);
	const placement = useMemo(() => {
		const ids = new Set<string>();
		for (const id of placedNotebookThreadIds(review?.base.threads ?? [], originalDocument))
			ids.add(id);
		for (const id of placedNotebookThreadIds(review?.worktree.threads ?? [], modifiedDocument)) {
			ids.add(id);
		}
		return ids;
	}, [modifiedDocument, originalDocument, review?.base.threads, review?.worktree.threads]);
	const layout = useMemo(() => {
		const baseKey = new Map<string, string>();
		const worktreeKey = new Map<string, string>();
		for (const entry of aligned) {
			const key = entryKey(entry);
			const cells = entryCells(entry);
			if (cells.original) baseKey.set(cells.original.ref, key);
			if (cells.modified) worktreeKey.set(cells.modified.ref, key);
		}
		const threads = new Map<string, ThreadEntry[]>();
		for (const [side, surface, document, keys] of [
			["base", review?.base, originalDocument, baseKey],
			["worktree", review?.worktree, modifiedDocument, worktreeKey],
		] as const) {
			if (!document) continue;
			for (const thread of surface?.threads ?? []) {
				const cell = notebookCellOfAnchor(thread.anchor, document);
				const key = cell ? keys.get(cell.ref) : undefined;
				if (!key) continue;
				const entries = threads.get(key) ?? [];
				entries.push({ thread, side });
				threads.set(key, entries);
			}
		}
		return { baseKey, worktreeKey, threads };
	}, [aligned, modifiedDocument, originalDocument, review]);
	const focusSurface = review
		? review.worktree.focus
			? { side: "worktree" as const, surface: review.worktree, document: modifiedDocument }
			: review.base.focus
				? { side: "base" as const, surface: review.base, document: originalDocument }
				: null
		: null;
	const focusId = focusSurface?.surface.focus?.id ?? null;

	useEffect(() => {
		onPlacedThreadIds?.(placement);
		return () => onPlacedThreadIds?.(NO_THREADS);
	}, [onPlacedThreadIds, placement]);

	useEffect(() => {
		if (!focusId) {
			handledFocusRef.current = null;
			return;
		}
		if (handledFocusRef.current === focusId || !focusSurface?.document || !placement.has(focusId)) {
			return;
		}
		const thread = focusSurface.surface.threads.find((candidate) => candidate.id === focusId);
		const cell = thread ? notebookCellOfAnchor(thread.anchor, focusSurface.document) : null;
		const key = cell
			? focusSurface.side === "base"
				? layout.baseKey.get(cell.ref)
				: layout.worktreeKey.get(cell.ref)
			: undefined;
		const element = key ? cellRefs.current.get(key) : null;
		if (!element) return;
		handledFocusRef.current = focusId;
		element.scrollIntoView({ block: "center" });
		focusSurface.surface.onFocusHandled();
	}, [focusId, focusSurface, layout.baseKey, layout.worktreeKey, placement]);

	if (
		(originalText !== null && !originalDocument) ||
		(modifiedText !== null && !modifiedDocument)
	) {
		return null;
	}
	const surfaceFor = (side: Side): SurfaceReview | undefined =>
		side === "base" ? review?.base : review?.worktree;
	const language = modifiedDocument?.language ?? originalDocument?.language ?? "python";

	return (
		<div
			ref={attachScroller}
			data-testid="notebook-diff"
			className="h-full overflow-auto bg-container-content-bg p-12"
		>
			<div className="mx-auto flex max-w-[1100px] flex-col gap-12">
				{aligned.map((entry) => {
					const key = entryKey(entry);
					const cells = entryCells(entry);
					const current = cells.modified ?? cells.original;
					if (!current) return null;
					const threadEntries = layout.threads.get(key) ?? [];
					const selection = composer.selection;
					const composing =
						composer.composing &&
						((selection?.side === "base" && selection.cell === cells.original) ||
							(selection?.side === "worktree" && selection.cell === cells.modified));
					const draft = selection && composing ? notebookCellDraft(selection.cell) : null;
					const composerSurface = selection ? surfaceFor(selection.side) : undefined;
					return (
						<section
							key={key}
							ref={(node) => {
								if (node) cellRefs.current.set(key, node);
								else cellRefs.current.delete(key);
							}}
							data-testid="notebook-diff-cell"
							data-state={entry.state}
							className={`overflow-hidden rounded-md border ${stateClass(entry.state)}`}
						>
							<header className="flex min-h-32 items-center gap-4 border-border-muted border-b bg-container-header-bg px-8">
								<span className="tr-text-eyebrow text-text-muted">
									{entry.state} · cell {current.index + 1} · {current.type}
								</span>
								{review ? (
									<span className="ml-auto flex gap-2">
										{cells.original ? (
											<CellCommentButton
												cell={cells.original}
												side="base"
												onSelect={composer.select}
											/>
										) : null}
										{cells.modified ? (
											<CellCommentButton
												cell={cells.modified}
												side="worktree"
												onSelect={composer.select}
											/>
										) : null}
									</span>
								) : null}
							</header>
							{entry.state === "changed" ? (
								<>
									<NotebookSourceDiff
										original={entry.original.source}
										modified={entry.modified.source}
										language={sourceLanguage(entry.modified, language)}
										ignoreWhitespace={ignoreWhitespace}
										name={`cell-${entry.modified.index + 1}`}
									/>
									<NotebookOutputsDiff
										original={entry.original}
										modified={entry.modified}
										ignoreWhitespace={ignoreWhitespace}
										stamp={`${stamp}:${key}`}
									/>
								</>
							) : entry.state === "unchanged" || entry.state === "added" ? (
								<NotebookCellBody cell={current} language={language} resource={resource} />
							) : (
								<div className="min-w-0 flex-1">
									<pre className="overflow-auto whitespace-pre-wrap p-12 tr-code-text text-text-default">
										{current.source}
									</pre>
									<NotebookOutputs cell={current} />
								</div>
							)}
							{composing && draft && composerSurface ? (
								<div className="border-border-muted border-t p-8">
									<ReviewComposer
										draft={draft}
										label={draft.label}
										commenting={composerSurface.commenting}
										onClose={composer.close}
									/>
								</div>
							) : null}
							{threadEntries.length > 0 ? (
								<div className="flex flex-col gap-4 border-border-muted border-t p-4">
									{threadEntries.map(({ thread, side }) => {
										const surface = surfaceFor(side);
										return surface ? (
											<ReviewThreadCard
												key={thread.id}
												thread={thread}
												actions={surface.actions}
												onActivate={() =>
													cellRefs.current.get(key)?.scrollIntoView({ block: "center" })
												}
											/>
										) : null;
									})}
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

export default function NotebookDiff(props: ResourceDiffProps) {
	return (
		<PierreProvider>
			<NotebookDiffSurface {...props} />
		</PierreProvider>
	);
}
