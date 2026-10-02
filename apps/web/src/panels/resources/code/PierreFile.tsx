import type { LineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { File } from "@pierre/diffs/react";
import { RiChatNewLine as MessageSquarePlus } from "@remixicon/react";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnchorDraft, ResourceViewProps } from "@/resources";
import { ReviewComposer } from "../../ReviewComposer";
import { ReviewThreadCard } from "../../ReviewThreadCard";
import { useScrollViewState } from "../../useScrollViewState";
import { type AnnotationSlot, reconcileAnnotationSlots } from "./annotationSlots";
import PierreProvider from "./PierreProvider";
import {
	composerLineLabel,
	draftLineLabel,
	filePlacedThreadIds,
	threadLineRange,
	usePierreFocus,
} from "./pierreReview";

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
}: ResourceViewProps) {
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
	usePierreFocus(rootRef, [review], placedThreadIds);

	return (
		<div
			ref={attachScroller}
			data-testid="file-view"
			className="h-full overflow-auto bg-container-workspace-bg pierre-code-surface pierre-file-surface"
		>
			<File<FileAnnotationMetadata>
				file={file}
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
							onClick={() => {
								const line = getHoveredLine();
								if (line) openSelection({ start: line.lineNumber, end: line.lineNumber });
							}}
							className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] bg-primary text-text-on-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
						>
							<MessageSquarePlus className="size-14" />
						</button>
					</IconTooltip>
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
		</div>
	);
}

export default function PierreFile(props: ResourceViewProps) {
	return (
		<PierreProvider>
			<PierreFileSurface {...props} />
		</PierreProvider>
	);
}
