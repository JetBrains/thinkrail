import {
	type AnnotationSide,
	type DiffLineAnnotation,
	type FileDiffMetadata,
	parseDiffFromFile,
	type SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff, VirtualizerContext } from "@pierre/diffs/react";
import {
	RiRobot2Line as AskAgent,
	RiCheckLine as Check,
	RiChatNewLine as MessageSquarePlus,
	RiArrowGoBackLine as Revert,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	ResourceContent,
	ResourceDiffProps,
	ReviewThread,
	ReviewThreadActions,
	SurfaceReview,
} from "../../registry";
import { ReviewComposer } from "../../support/ReviewComposer";
import { ReviewThreadCard } from "../../support/ReviewThreadCard";
import { useScrollViewState } from "../../support/useScrollViewState";
import { diffContentStamp, useStampedComposer } from "../reviewComposerState";
import { StaleComposerNotice } from "../StaleComposerNotice";
import { type AnnotationSlot, reconcileAnnotationSlots } from "./annotationSlots";
import {
	type ChangeBlock,
	changeBlockContentKeys,
	changeBlockId,
	computeActionBlocks,
} from "./changeBlocks";
import { createDiffCache } from "./diffCache";
import PierreProvider from "./PierreProvider";
import { PierreScroller } from "./PierreScroller";
import {
	type BlockedSelection,
	COLLAPSED_CONTEXT_THRESHOLD,
	composerLineLabel,
	diffPlacedThreadIds,
	type OpenComposer,
	selectionComposer,
	threadLineRange,
	usePierreFocus,
} from "./pierreReview";
import { usePierreVirtualizer } from "./pierreVirtualizer";

type DiffAnnotationMetadata =
	| { kind: "thread"; id: string }
	| { kind: "composer"; id: number }
	| { kind: "hunk"; id: string };

const NO_PLACED_THREADS: ReadonlySet<string> = new Set();
const NO_BLOCKS: ChangeBlock[] = [];
const parsedDiffs = createDiffCache<FileDiffMetadata>();
const actionBlocks = createDiffCache<ChangeBlock[]>();

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
	contentKey,
	actions,
	onAskAgent,
}: {
	block: ChangeBlock;
	contentKey: string;
	actions: NonNullable<ResourceDiffProps["hunkActions"]>;
	onAskAgent: (block: ChangeBlock) => void;
}) {
	const t = useT();
	const [reverting, setReverting] = useState(false);
	const revert = () => {
		setReverting(true);
		void actions.revert(block).then(
			() => setReverting(false),
			() => setReverting(false),
		);
	};
	const triage = actions.triage;
	const kept = triage?.keptKeys.has(contentKey) ?? false;
	return (
		<div
			data-testid="hunk-toolbar"
			data-kept={kept ? true : undefined}
			className={`mx-12 my-2 flex min-h-24 items-center gap-4 rounded-sm border bg-container-header-bg px-4 text-text-muted ${
				kept ? "border-feedback-success-muted" : "border-border-muted"
			}`}
			onPointerDown={(event) => event.stopPropagation()}
		>
			{triage ? (
				<IconTooltip label={kept ? t("viewer.hunk.keptTooltip") : t("viewer.hunk.keepTooltip")}>
					<Button
						variant="ghost"
						size="m"
						iconLeft={Check}
						data-testid="hunk-keep"
						aria-label={kept ? t("viewer.hunk.undoKeep") : t("viewer.hunk.keepLabel")}
						aria-pressed={kept}
						selected={kept}
						onClick={() => triage.setKept(contentKey, !kept)}
					>
						{kept ? t("viewer.hunk.kept") : t("viewer.hunk.keep")}
					</Button>
				</IconTooltip>
			) : null}
			<IconButton
				icon={Revert}
				label={t("viewer.hunk.revert")}
				data-testid="hunk-revert"
				disabled={reverting}
				onClick={revert}
			/>
			<IconButton
				icon={AskAgent}
				label={t("viewer.hunk.askAgent")}
				data-testid="hunk-ask-agent"
				onClick={() => onAskAgent(block)}
			/>
			{actions.agentWorking ? (
				<span className="tr-text-metadata text-text-subtle">{t("viewer.hunk.agentWorking")}</span>
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
	virtualize = false,
}: ResourceDiffProps) {
	const t = useT();
	const originalText = textSide(original);
	const modifiedText = textSide(modified);
	const originalHash = contentHash(original);
	const modifiedHash = contentHash(modified);
	const fileDiff = useMemo(
		() =>
			parsedDiffs(
				[
					originalText,
					modifiedText,
					resource.path,
					resource.language,
					originalHash,
					modifiedHash,
					ignoreWhitespace,
				],
				() => {
					const sideKey = (hash: string | undefined) =>
						hash ? `${resource.language ?? resource.path}:${hash}` : undefined;
					const originalKey = sideKey(originalHash);
					const modifiedKey = sideKey(modifiedHash);
					const side = (contents: string, cacheKey: string | undefined) => ({
						name: resource.path,
						contents,
						...(resource.language ? { lang: resource.language } : {}),
						...(cacheKey ? { cacheKey } : {}),
					});
					const parsed = parseDiffFromFile(
						originalText === null ? null : side(originalText, originalKey),
						modifiedText === null ? null : side(modifiedText, modifiedKey),
						{ ignoreWhitespace },
					);
					const oneSidedKey =
						originalText === null ? modifiedKey : modifiedText === null ? originalKey : undefined;
					return parsed.cacheKey === undefined && oneSidedKey
						? { ...parsed, cacheKey: `${parsed.type}:${oneSidedKey}` }
						: parsed;
				},
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
	const hasHunkActions = hunkActions !== undefined;
	const blocks = useMemo(
		() =>
			hasHunkActions
				? actionBlocks([originalText, modifiedText, ignoreWhitespace], () =>
						computeActionBlocks(originalText, modifiedText, ignoreWhitespace),
					)
				: NO_BLOCKS,
		[hasHunkActions, ignoreWhitespace, modifiedText, originalText],
	);
	const blockById = useMemo(
		() => new Map(blocks.map((block) => [changeBlockId(block), block])),
		[blocks],
	);
	const triage = hunkActions?.triage;
	const triageEnabled = triage !== undefined;
	const contentKeyById = useMemo(
		() =>
			triageEnabled
				? changeBlockContentKeys(blocks, originalText ?? "", modifiedText ?? "")
				: new Map<string, string>(),
		[blocks, modifiedText, originalText, triageEnabled],
	);
	const onHunkKeys = triage?.onHunkKeys;
	useEffect(() => {
		onHunkKeys?.([...contentKeyById.values()]);
	}, [contentKeyById, onHunkKeys]);
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
	const pending = useStampedComposer<{
		composer: OpenComposer | BlockedSelection;
		selectedLines: SelectedLineRange | null;
	}>(diffContentStamp(original, modified));
	const composer = pending.selection?.composer ?? null;
	const selectedLines = pending.selection?.selectedLines ?? null;
	const { select, close: closeComposer } = pending;
	const nextComposerId = useRef(composer?.id ?? 0);
	const reviewRef = useRef(review);
	const hunkActionsRef = useRef(hunkActions);
	reviewRef.current = review;
	hunkActionsRef.current = hunkActions;
	const openSelection = useCallback(
		(range: SelectedLineRange | null) => {
			if (!range || !reviewRef.current) return;
			const next = selectionComposer(range, ++nextComposerId.current);
			select({
				composer: next,
				selectedLines:
					next.kind === "composer" && next.draft.selectors[0]?.kind === "lineRange"
						? {
								start: next.draft.selectors[0].startLine,
								end: next.draft.selectors[0].endLine,
								side: next.side,
							}
						: range,
			});
		},
		[select],
	);
	const openGutterComposer = useCallback(
		(line: { lineNumber: number; side: AnnotationSide } | undefined) => {
			if (!line) return;
			openSelection({ start: line.lineNumber, end: line.lineNumber, side: line.side });
		},
		[openSelection],
	);
	const openAskAgent = useCallback(
		(block: ChangeBlock) => {
			const actions = hunkActionsRef.current;
			if (!actions) return;
			const request = actions.askAgent(block);
			const range = request.draft.selectors.find((selector) => selector.kind === "lineRange");
			const lineNumber = range?.kind === "lineRange" ? range.endLine : 0;
			const id = ++nextComposerId.current;
			select({
				selectedLines:
					range?.kind === "lineRange"
						? { start: range.startLine, end: range.endLine, side: "additions" }
						: null,
				composer: {
					kind: "composer",
					id,
					side: "additions",
					lineNumber,
					draft: request.draft,
					label:
						range?.kind === "lineRange"
							? composerLineLabel(range.startLine, range.endLine)
							: t("viewer.hunk.changed"),
					initialText: request.initialText,
					...(request.notice ? { notice: request.notice } : {}),
				},
			});
		},
		[select],
	);
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
	const { virtualizer, metrics, attach } = usePierreVirtualizer(attachScroller);
	usePierreFocus(
		rootRef,
		virtualizer,
		[
			{ review: review?.base, side: "deletions" },
			{ review: review?.worktree, side: "additions" },
		],
		placedThreadIds,
	);
	const [restoredComposerId] = useState(composer?.id);
	const openedComposer =
		composer?.kind === "composer" && composer.id !== restoredComposerId ? composer : null;
	useEffect(() => {
		if (!openedComposer) return;
		const element = rootRef.current?.querySelector('[data-testid="review-composer"]');
		if (element && element.getClientRects().length > 0) return;
		virtualizer.revealLine(openedComposer.lineNumber, openedComposer.side);
	}, [openedComposer, rootRef, virtualizer]);

	return (
		<PierreScroller
			attach={attach}
			testId="diff-view"
			className="h-full overflow-auto bg-container-content-bg [overflow-anchor:none] pierre-code-surface pierre-diff-surface"
		>
			<StaleComposerNotice visible={pending.stale} />
			<VirtualizerContext.Provider value={virtualize ? virtualizer : undefined}>
				{fileDiff.hunks.length === 0 ? (
					<p data-testid="diff-empty" className="px-12 py-8 tr-text-ui text-text-muted">
						{t("viewer.code.noDifferences")}
					</p>
				) : null}
				<FileDiff<DiffAnnotationMetadata>
					fileDiff={fileDiff}
					options={options}
					metrics={metrics}
					lineAnnotations={annotations}
					selectedLines={selectedLines}
					className="flex-1"
					renderGutterUtility={(getHoveredLine) => (
						<IconButton
							icon={MessageSquarePlus}
							label={t("viewer.code.commentOnLine")}
							variant="primary"
							data-testid="review-add-icon"
							onPointerDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
							}}
							onClick={() => openGutterComposer(getHoveredLine())}
						/>
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
									contentKey={contentKeyById.get(metadata.id) ?? metadata.id}
									actions={hunkActions}
									onAskAgent={openAskAgent}
								/>
							) : null;
						}
						if (!composer || composer.id !== metadata.id || !review) return null;
						if (composer.kind === "blocked") {
							return (
								<div
									key={composer.id}
									data-testid="review-selection-blocked"
									className="review-composer review-composer-flow flex items-center gap-8"
								>
									<span className="tr-text-metadata text-text-muted">{t(composer.message)}</span>
									<button
										type="button"
										data-testid="review-selection-blocked-close"
										className="tr-text-metadata text-text-default underline-offset-2 hover:underline"
										onClick={closeComposer}
									>
										{t("common.dismiss")}
									</button>
								</div>
							);
						}
						return (
							<ReviewComposer
								key={pending.key ?? composer.id}
								input={pending.input}
								draft={composer.draft}
								label={composer.label}
								commenting={surfaceForSide(review, composer.side).commenting}
								{...(composer.initialText !== undefined
									? { initialText: composer.initialText }
									: {})}
								{...(composer.notice !== undefined ? { notice: composer.notice } : {})}
								onClose={closeComposer}
								className="review-composer-flow"
							/>
						);
					}}
				/>
			</VirtualizerContext.Provider>
		</PierreScroller>
	);
}

export default function PierreDiff(props: ResourceDiffProps) {
	return (
		<PierreProvider>
			<PierreDiffSurface {...props} />
		</PierreProvider>
	);
}
