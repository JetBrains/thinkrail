import {
	type AnnotationSide,
	type DiffLineAnnotation,
	parseDiffFromFile,
	type SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import {
	RiRobot2Line as AskAgent,
	RiChatNewLine as MessageSquarePlus,
	RiArrowGoBackLine as Revert,
} from "@remixicon/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconTooltip } from "@/components/ui/tooltip";
import type {
	AnchorDraft,
	ResourceContent,
	ResourceDiffProps,
	ReviewThread,
	ReviewThreadActions,
	SurfaceReview,
} from "@/resources";
import { ReviewComposer } from "../../ReviewComposer";
import { ReviewThreadCard } from "../../ReviewThreadCard";
import { useScrollViewState } from "../../useScrollViewState";
import { type AnnotationSlot, reconcileAnnotationSlots } from "./annotationSlots";
import { type ChangeBlock, changeBlockId, computeActionBlocks } from "./changeBlocks";
import PierreProvider from "./PierreProvider";
import {
	COLLAPSED_CONTEXT_THRESHOLD,
	composerLineLabel,
	diffPlacedThreadIds,
	draftLineLabel,
	threadLineRange,
	usePierreFocus,
} from "./pierreReview";

type DiffAnnotationMetadata =
	| { kind: "thread"; id: string }
	| { kind: "composer"; id: number }
	| { kind: "hunk"; id: string };

const NO_PLACED_THREADS: ReadonlySet<string> = new Set();

interface OpenComposer {
	id: number;
	side: AnnotationSide;
	lineNumber: number;
	draft: AnchorDraft;
	label: string;
	initialText?: string;
	notice?: string;
}

function textSide(content: ResourceContent): string | null {
	return content.kind === "text" ? content.text : null;
}

function contentHash(content: ResourceContent): string | undefined {
	return content.kind === "absent" || !content.hash ? undefined : content.hash;
}

function surfaceForSide(
	review: NonNullable<ResourceDiffProps["review"]>,
	side: AnnotationSide,
): SurfaceReview {
	return side === "deletions" ? review.base : review.worktree;
}

function selectionComposer(range: SelectedLineRange, id: number): OpenComposer {
	const startSide = range.side ?? "additions";
	const endSide = range.endSide ?? startSide;
	if (startSide !== endSide) {
		const lineNumber = startSide === "additions" ? range.start : range.end;
		return {
			id,
			side: "additions",
			lineNumber,
			draft: {
				selectors: [{ kind: "lineRange", startLine: lineNumber, endLine: lineNumber }],
				label: draftLineLabel(lineNumber, lineNumber),
			},
			label: composerLineLabel(lineNumber, lineNumber),
			notice: "Selection crossed both sides; commenting on the additions side.",
		};
	}
	const startLine = Math.min(range.start, range.end);
	const endLine = Math.max(range.start, range.end);
	return {
		id,
		side: startSide,
		lineNumber: endLine,
		draft: {
			selectors: [{ kind: "lineRange", startLine, endLine }],
			label: draftLineLabel(startLine, endLine),
		},
		label: composerLineLabel(startLine, endLine),
	};
}

function actionAnnotation(block: ChangeBlock): DiffLineAnnotation<DiffAnnotationMetadata> {
	const additions = block.modified.count > 0;
	const side = additions ? "additions" : "deletions";
	const start = additions ? block.modified.start : block.original.start;
	return {
		side,
		lineNumber: Math.max(0, start - 1),
		metadata: { kind: "hunk", id: changeBlockId(block) },
	};
}

function sameDiffAnnotation(
	left: DiffLineAnnotation<DiffAnnotationMetadata>,
	right: DiffLineAnnotation<DiffAnnotationMetadata>,
): boolean {
	return left.side === right.side && left.lineNumber === right.lineNumber;
}

function useThreadAnnotations(
	review: ResourceDiffProps["review"],
	placedThreadIds: ReadonlySet<string>,
) {
	const slotsRef = useRef<AnnotationSlot<DiffLineAnnotation<DiffAnnotationMetadata>>[]>([]);
	return useMemo(() => {
		const current: {
			id: string;
			annotation: DiffLineAnnotation<DiffAnnotationMetadata>;
		}[] = [];
		for (const [surface, side] of [
			[review?.base, "deletions"],
			[review?.worktree, "additions"],
		] as const) {
			for (const thread of surface?.threads ?? []) {
				if (!placedThreadIds.has(thread.id)) continue;
				const range = threadLineRange(thread);
				if (!range) continue;
				current.push({
					id: thread.id,
					annotation: {
						side,
						lineNumber: range.endLine,
						metadata: { kind: "thread", id: thread.id },
					},
				});
			}
		}
		const slots = reconcileAnnotationSlots(slotsRef.current, current, sameDiffAnnotation);
		slotsRef.current = slots;
		return slots.map((slot) => slot.annotation);
	}, [placedThreadIds, review?.base.threads, review?.worktree.threads]);
}

function HunkToolbar({
	block,
	actions,
	onAskAgent,
}: {
	block: ChangeBlock;
	actions: NonNullable<ResourceDiffProps["hunkActions"]>;
	onAskAgent: (block: ChangeBlock) => void;
}) {
	const [reverting, setReverting] = useState(false);
	const revert = () => {
		setReverting(true);
		void actions.revert(block).then(
			() => setReverting(false),
			() => setReverting(false),
		);
	};
	return (
		<div
			data-testid="hunk-toolbar"
			className="mx-12 my-2 flex min-h-24 items-center gap-4 rounded-[var(--radius-sm)] border border-border-muted bg-container-header-bg px-4 text-text-muted"
			onPointerDown={(event) => event.stopPropagation()}
		>
			<IconTooltip label="Revert hunk">
				<button
					type="button"
					data-testid="hunk-revert"
					aria-label="Revert hunk"
					disabled={reverting}
					onClick={revert}
					className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text"
				>
					<Revert className="size-14" />
				</button>
			</IconTooltip>
			<IconTooltip label="Ask agent about this hunk">
				<button
					type="button"
					data-testid="hunk-ask-agent"
					aria-label="Ask agent about this hunk"
					onClick={() => onAskAgent(block)}
					className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
				>
					<AskAgent className="size-14" />
				</button>
			</IconTooltip>
			{actions.agentWorking ? (
				<span className="tr-text-metadata text-text-subtle">
					the agent is working in this workspace
				</span>
			) : null}
		</div>
	);
}

function PierreDiffSurface({
	resource,
	original,
	modified,
	layout,
	ignoreWhitespace,
	review,
	hunkActions,
	onPlacedThreadIds,
	viewState,
	onViewState,
}: ResourceDiffProps) {
	const originalText = textSide(original);
	const modifiedText = textSide(modified);
	const originalHash = contentHash(original);
	const modifiedHash = contentHash(modified);
	const fileDiff = useMemo(
		() =>
			parseDiffFromFile(
				originalText === null
					? null
					: {
							name: resource.path,
							contents: originalText,
							...(resource.language ? { lang: resource.language } : {}),
							...(originalHash
								? { cacheKey: `${resource.language ?? resource.path}:${originalHash}` }
								: {}),
						},
				modifiedText === null
					? null
					: {
							name: resource.path,
							contents: modifiedText,
							...(resource.language ? { lang: resource.language } : {}),
							...(modifiedHash
								? { cacheKey: `${resource.language ?? resource.path}:${modifiedHash}` }
								: {}),
						},
				{ ignoreWhitespace },
			),
		[
			ignoreWhitespace,
			modifiedHash,
			modifiedText,
			originalHash,
			originalText,
			resource.language,
			resource.path,
		],
	);
	const blocks = useMemo(
		() => computeActionBlocks(originalText, modifiedText, ignoreWhitespace),
		[ignoreWhitespace, modifiedText, originalText],
	);
	const blockById = useMemo(
		() => new Map(blocks.map((block) => [changeBlockId(block), block])),
		[blocks],
	);
	const placedThreadIds = useMemo(
		() => diffPlacedThreadIds(fileDiff, review),
		[fileDiff, review?.base.threads, review?.worktree.threads],
	);
	useEffect(() => {
		onPlacedThreadIds?.(placedThreadIds);
		return () => onPlacedThreadIds?.(NO_PLACED_THREADS);
	}, [onPlacedThreadIds, placedThreadIds]);
	const threadAnnotations = useThreadAnnotations(review, placedThreadIds);
	const hunkAnnotations = useMemo(
		() => (hunkActions ? blocks.map(actionAnnotation) : []),
		[blocks, hunkActions],
	);
	const [composer, setComposer] = useState<OpenComposer | null>(null);
	const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);
	const nextComposerId = useRef(0);
	const reviewRef = useRef(review);
	const hunkActionsRef = useRef(hunkActions);
	reviewRef.current = review;
	hunkActionsRef.current = hunkActions;
	const openSelection = useCallback((range: SelectedLineRange | null) => {
		if (!range || !reviewRef.current) return;
		const next = selectionComposer(range, ++nextComposerId.current);
		setSelectedLines({
			start:
				next.draft.selectors[0]?.kind === "lineRange"
					? next.draft.selectors[0].startLine
					: range.start,
			end:
				next.draft.selectors[0]?.kind === "lineRange" ? next.draft.selectors[0].endLine : range.end,
			side: next.side,
		});
		setComposer(next);
	}, []);
	const openGutterComposer = useCallback(
		(line: { lineNumber: number; side: AnnotationSide } | undefined) => {
			if (!line) return;
			openSelection({ start: line.lineNumber, end: line.lineNumber, side: line.side });
		},
		[openSelection],
	);
	const openAskAgent = useCallback((block: ChangeBlock) => {
		const actions = hunkActionsRef.current;
		if (!actions) return;
		const request = actions.askAgent(block);
		const range = request.draft.selectors.find((selector) => selector.kind === "lineRange");
		const lineNumber = range?.kind === "lineRange" ? range.endLine : 0;
		const id = ++nextComposerId.current;
		setSelectedLines(
			range?.kind === "lineRange"
				? {
						start: range.startLine,
						end: range.endLine,
						side: "additions",
					}
				: null,
		);
		setComposer({
			id,
			side: "additions",
			lineNumber,
			draft: request.draft,
			label:
				range?.kind === "lineRange"
					? composerLineLabel(range.startLine, range.endLine)
					: "Changed hunk",
			initialText: request.initialText,
			...(request.notice ? { notice: request.notice } : {}),
		});
	}, []);
	const closeComposer = useCallback(() => {
		setComposer(null);
		setSelectedLines(null);
	}, []);
	const composerAnnotation = useMemo<DiffLineAnnotation<DiffAnnotationMetadata>>(
		() => ({
			side: composer?.side ?? "additions",
			lineNumber: composer?.lineNumber ?? 0,
			metadata: { kind: "composer", id: composer?.id ?? 0 },
		}),
		[composer],
	);
	const annotations = useMemo<DiffLineAnnotation<DiffAnnotationMetadata>[]>(
		() => [composerAnnotation, ...threadAnnotations, ...hunkAnnotations],
		[composerAnnotation, hunkAnnotations, threadAnnotations],
	);
	const threadById = useMemo(() => {
		const result = new Map<string, { thread: ReviewThread; actions: ReviewThreadActions }>();
		for (const surface of review ? [review.base, review.worktree] : []) {
			for (const thread of surface.threads) {
				result.set(thread.id, { thread, actions: surface.actions });
			}
		}
		return result;
	}, [review]);
	const options = useMemo(
		() => ({
			theme: "thinkrail",
			diffStyle: layout,
			expandUnchanged: false,
			collapsedContextThreshold: COLLAPSED_CONTEXT_THRESHOLD,
			hunkSeparators: "line-info" as const,
			lineDiffType: "word" as const,
			parseDiffOptions: { ignoreWhitespace },
			overflow: "scroll" as const,
			disableFileHeader: true,
			enableLineSelection: review !== undefined,
			enableGutterUtility: review !== undefined,
			onLineSelectionEnd: openSelection,
		}),
		[ignoreWhitespace, layout, openSelection, review],
	);
	const { elementRef: rootRef, attach: attachScroller } = useScrollViewState<HTMLDivElement>(
		viewState,
		onViewState,
	);
	usePierreFocus(rootRef, [review?.base, review?.worktree], placedThreadIds);

	return (
		<div
			ref={attachScroller}
			data-testid="diff-view"
			className="h-full overflow-auto bg-container-content-bg pierre-code-surface pierre-diff-surface"
		>
			{fileDiff.hunks.length === 0 ? (
				<p data-testid="diff-empty" className="px-12 py-8 tr-text-ui text-text-muted">
					No differences between the two sides.
				</p>
			) : null}
			<FileDiff<DiffAnnotationMetadata>
				fileDiff={fileDiff}
				options={options}
				lineAnnotations={annotations}
				selectedLines={selectedLines}
				className="min-h-full"
				renderGutterUtility={(getHoveredLine) => (
					<IconTooltip label="Comment on this line">
						<button
							type="button"
							data-testid="review-add-icon"
							aria-label="Comment on this line"
							onPointerDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
							}}
							onClick={() => openGutterComposer(getHoveredLine())}
							className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] bg-primary text-text-on-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
						>
							<MessageSquarePlus className="size-14" />
						</button>
					</IconTooltip>
				)}
				renderAnnotation={(annotation) => {
					const metadata = annotation.metadata;
					if (metadata.kind === "thread") {
						const entry = threadById.get(metadata.id);
						return entry && placedThreadIds.has(metadata.id) ? (
							<ReviewThreadCard
								key={entry.thread.id}
								thread={entry.thread}
								actions={entry.actions}
							/>
						) : null;
					}
					if (metadata.kind === "hunk") {
						const block = blockById.get(metadata.id);
						return block && hunkActions ? (
							<HunkToolbar
								key={metadata.id}
								block={block}
								actions={hunkActions}
								onAskAgent={openAskAgent}
							/>
						) : null;
					}
					if (!composer || composer.id !== metadata.id || !review) return null;
					return (
						<ReviewComposer
							key={composer.id}
							draft={composer.draft}
							label={composer.label}
							commenting={surfaceForSide(review, composer.side).commenting}
							{...(composer.initialText !== undefined ? { initialText: composer.initialText } : {})}
							{...(composer.notice !== undefined ? { notice: composer.notice } : {})}
							onClose={closeComposer}
							className="review-composer-flow"
						/>
					);
				}}
			/>
		</div>
	);
}

export default function PierreDiff(props: ResourceDiffProps) {
	return (
		<PierreProvider>
			<PierreDiffSurface {...props} />
		</PierreProvider>
	);
}
