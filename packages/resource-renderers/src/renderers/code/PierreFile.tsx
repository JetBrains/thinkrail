import type { LineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { File, VirtualizerContext } from "@pierre/diffs/react";
import { RiChatNewLine as MessageSquarePlus } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnchorDraft, ResourceViewProps } from "../../registry";
import { ReviewComposer } from "../../support/ReviewComposer";
import { ReviewThreadCard } from "../../support/ReviewThreadCard";
import { useScrollViewState } from "../../support/useScrollViewState";
import { type AnnotationSlot, reconcileAnnotationSlots } from "./annotationSlots";
import PierreProvider from "./PierreProvider";
import { PierreScroller } from "./PierreScroller";
import {
	composerLineLabel,
	draftLineLabel,
	filePlacedThreadIds,
	threadLineRange,
	usePierreFocus,
} from "./pierreReview";
import { usePierreVirtualizer } from "./pierreVirtualizer";

const NO_PLACED_THREADS: ReadonlySet<string> = new Set();

type FileAnnotationMetadata = { kind: "thread"; id: string } | { kind: "composer"; id: number };

interface OpenComposer {
	id: number;
	lineNumber: number;
	draft: AnchorDraft;
	label: string;
}

function sameFileAnnotation(
	left: LineAnnotation<FileAnnotationMetadata>,
	right: LineAnnotation<FileAnnotationMetadata>,
): boolean {
	return left.lineNumber === right.lineNumber;
}

function useThreadAnnotations(
	review: ResourceViewProps["review"],
	placedThreadIds: ReadonlySet<string>,
) {
	const slotsRef = useRef<AnnotationSlot<LineAnnotation<FileAnnotationMetadata>>[]>([]);
	return useMemo(() => {
		const current = (review?.threads ?? []).flatMap((thread) => {
			const range = threadLineRange(thread);
			return range && placedThreadIds.has(thread.id)
				? [
						{
							id: thread.id,
							annotation: {
								lineNumber: range.endLine,
								metadata: { kind: "thread" as const, id: thread.id },
							},
						},
					]
				: [];
		});
		const slots = reconcileAnnotationSlots(slotsRef.current, current, sameFileAnnotation);
		slotsRef.current = slots;
		return slots.map((slot) => slot.annotation);
	}, [placedThreadIds, review?.threads]);
}

function PierreFileSurface({
	resource,
	content,
	review,
	onPlacedThreadIds,
	viewState,
	onViewState,
	reveal,
}: ResourceViewProps) {
	const t = useT();
	const text = content.kind === "text" ? content.text : "";
	const hash = content.kind === "absent" || !content.hash ? undefined : content.hash;
	const file = useMemo(
		() => ({
			name: resource.path,
			contents: text,
			...(resource.language ? { lang: resource.language } : {}),
			...(hash ? { cacheKey: `${resource.language ?? resource.path}:${hash}` } : {}),
		}),
		[hash, resource.language, resource.path, text],
	);
	const placedThreadIds = useMemo(
		() => filePlacedThreadIds(text, review?.threads ?? []),
		[review?.threads, text],
	);
	useEffect(() => {
		onPlacedThreadIds?.(placedThreadIds);
		return () => onPlacedThreadIds?.(NO_PLACED_THREADS);
	}, [onPlacedThreadIds, placedThreadIds]);
	const threadAnnotations = useThreadAnnotations(review, placedThreadIds);
	const [composer, setComposer] = useState<OpenComposer | null>(null);
	const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);
	const nextComposerId = useRef(0);
	const reviewRef = useRef(review);
	reviewRef.current = review;
	const openSelection = useCallback((range: SelectedLineRange | null) => {
		if (!range || !reviewRef.current) return;
		const startLine = Math.min(range.start, range.end);
		const endLine = Math.max(range.start, range.end);
		setSelectedLines({ start: startLine, end: endLine });
		setComposer({
			id: ++nextComposerId.current,
			lineNumber: endLine,
			draft: {
				selectors: [{ kind: "lineRange", startLine, endLine }],
				label: draftLineLabel(startLine, endLine),
			},
			label: composerLineLabel(startLine, endLine),
		});
	}, []);
	const closeComposer = useCallback(() => {
		setComposer(null);
		setSelectedLines(null);
	}, []);
	const composerAnnotation = useMemo<LineAnnotation<FileAnnotationMetadata>>(
		() => ({
			lineNumber: composer?.lineNumber ?? 0,
			metadata: { kind: "composer", id: composer?.id ?? 0 },
		}),
		[composer],
	);
	const annotations = useMemo<LineAnnotation<FileAnnotationMetadata>[]>(
		() => [composerAnnotation, ...threadAnnotations],
		[composerAnnotation, threadAnnotations],
	);
	const threadById = useMemo(
		() => new Map((review?.threads ?? []).map((thread) => [thread.id, thread])),
		[review?.threads],
	);
	const options = useMemo(
		() => ({
			theme: "thinkrail",
			overflow: "scroll" as const,
			disableFileHeader: true,
			enableLineSelection: review !== undefined,
			enableGutterUtility: review !== undefined,
			onLineSelectionEnd: openSelection,
		}),
		[openSelection, review],
	);
	const { elementRef: rootRef, attach: attachScroller } = useScrollViewState<HTMLDivElement>(
		viewState,
		onViewState,
	);
	const { virtualizer, metrics, attach } = usePierreVirtualizer(attachScroller);
	usePierreFocus(rootRef, virtualizer, [{ review }], placedThreadIds);
	const revealLine = reveal?.line;
	const revealTick = reveal?.tick;
	useEffect(() => {
		if (revealLine === undefined || revealTick === undefined) return;
		let frame = 0;
		let attempts = 0;
		const attempt = () => {
			if (virtualizer.revealLine(revealLine)) {
				setSelectedLines({ start: revealLine, end: revealLine });
				return;
			}
			attempts += 1;
			if (attempts < 30) frame = requestAnimationFrame(attempt);
		};
		attempt();
		return () => cancelAnimationFrame(frame);
	}, [virtualizer, revealLine, revealTick]);

	return (
		<PierreScroller
			attach={attach}
			testId="file-view"
			className="h-full overflow-auto bg-container-workspace-bg [overflow-anchor:none] pierre-code-surface pierre-file-surface"
		>
			<VirtualizerContext.Provider value={virtualizer}>
				<File<FileAnnotationMetadata>
					file={file}
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
							onClick={() => {
								const line = getHoveredLine();
								if (line) openSelection({ start: line.lineNumber, end: line.lineNumber });
							}}
						/>
					)}
					renderAnnotation={(annotation) => {
						const metadata = annotation.metadata;
						if (metadata.kind === "thread") {
							const thread = threadById.get(metadata.id);
							return thread && review && placedThreadIds.has(metadata.id) ? (
								<ReviewThreadCard key={thread.id} thread={thread} actions={review.actions} />
							) : null;
						}
						if (!composer || composer.id !== metadata.id || !review) return null;
						return (
							<ReviewComposer
								key={composer.id}
								draft={composer.draft}
								label={composer.label}
								commenting={review.commenting}
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

export default function PierreFile(props: ResourceViewProps) {
	return (
		<PierreProvider>
			<PierreFileSurface {...props} />
		</PierreProvider>
	);
}
