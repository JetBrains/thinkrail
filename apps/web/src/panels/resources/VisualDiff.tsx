import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { AnchorDraft, SurfaceReview } from "@/resources";
import { ToggleSegment } from "../ToggleSegment";
import { RegionReviewSurface } from "./RegionReviewSurface";
import { placedRegionThreadIds, type Region, type Size } from "./regionReview";

const NO_THREADS: ReadonlySet<string> = new Set();

export type VisualDiffMode = "2-up" | "swipe" | "onion" | "difference";

const MODES: readonly { mode: VisualDiffMode; label: string }[] = [
	{ mode: "2-up", label: "2-up" },
	{ mode: "swipe", label: "Swipe" },
	{ mode: "onion", label: "Onion skin" },
	{ mode: "difference", label: "Difference" },
];
const ALL_MODES = MODES.map(({ mode }) => mode);

export interface VisualDiffSide {
	present: boolean;
	content: ReactNode;
	caption: string;
	intrinsicSize: Size | null;
	review?: SurfaceReview | undefined;
	draftForRegion?: ((region: Region) => AnchorDraft) | undefined;
}

function aspectOf(size: Size | null): number | null {
	return size && size.width > 0 && size.height > 0 ? size.width / size.height : null;
}

function frameClass(size: Size | null, maximumHeight: 58 | 68, backdrop = true): string {
	const fallback =
		maximumHeight === 58 ? "h-[min(58vh,640px)] w-full" : "h-[min(68vh,720px)] w-full";
	return `${aspectOf(size) ? "mx-auto w-full" : fallback} min-h-40 border border-border-muted ${backdrop ? "media-backdrop" : "bg-container-content-bg"}`;
}

function frameStyle(size: Size | null, maximumHeight: 58 | 68): React.CSSProperties | undefined {
	const aspect = aspectOf(size);
	return aspect
		? {
				aspectRatio: aspect,
				maxWidth: `${maximumHeight * aspect}vh`,
			}
		: undefined;
}

function EmptyFrame({ label }: { label: string }) {
	return (
		<div className="flex h-full min-h-40 w-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
			{label}
		</div>
	);
}

function SideSurface({
	label,
	selectionKey,
	side,
	regionLabel,
	contentStamp,
	emptyLabel,
}: {
	label: string;
	selectionKey: string;
	side: VisualDiffSide;
	regionLabel: string;
	contentStamp: string;
	emptyLabel: string;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<span className="tr-text-metadata text-text-muted">{label}</span>
			<RegionReviewSurface
				{...(side.present ? { review: side.review } : {})}
				intrinsicSize={side.intrinsicSize}
				contentStamp={contentStamp}
				selectionKey={selectionKey}
				className={frameClass(side.intrinsicSize, 58)}
				{...(frameStyle(side.intrinsicSize, 58)
					? { style: frameStyle(side.intrinsicSize, 58) }
					: {})}
				label={regionLabel}
				{...(side.draftForRegion ? { draftForRegion: side.draftForRegion } : {})}
			>
				{side.present ? side.content : <EmptyFrame label={emptyLabel} />}
			</RegionReviewSurface>
		</div>
	);
}

export function VisualDiff({
	prefix,
	noun,
	regionLabel,
	original,
	modified,
	contentStamp,
	onPlacedThreadIds,
	initialMode,
	onViewState,
	modes = ALL_MODES,
	emptyLabel = "No image",
}: {
	prefix: "image" | "svg" | "html";
	noun: string;
	regionLabel: string;
	original: VisualDiffSide;
	modified: VisualDiffSide;
	contentStamp: string;
	onPlacedThreadIds?: ((ids: ReadonlySet<string>) => void) | undefined;
	initialMode: VisualDiffMode;
	onViewState?: ((state: unknown) => void) | undefined;
	modes?: readonly VisualDiffMode[] | undefined;
	emptyLabel?: string | undefined;
}) {
	const [mode, setMode] = useState<VisualDiffMode>(initialMode);
	const [activeSide, setActiveSide] = useState<"base" | "worktree">("worktree");
	const [divider, setDivider] = useState(50);
	const [opacity, setOpacity] = useState(50);
	const layeredRef = useRef<HTMLDivElement>(null);
	const active = activeSide === "base" ? original : modified;
	const inactive = activeSide === "base" ? modified : original;
	const availableModes = MODES.filter(({ mode: candidate }) => modes.includes(candidate));
	const placedThreadIds = useMemo(() => {
		const ids = new Set<string>();
		for (const side of [original, modified]) {
			if (!side.present) continue;
			for (const id of placedRegionThreadIds(side.review?.threads ?? [], side.intrinsicSize)) {
				ids.add(id);
			}
		}
		return ids;
	}, [modified, original]);

	useEffect(() => {
		onPlacedThreadIds?.(placedThreadIds);
		return () => onPlacedThreadIds?.(NO_THREADS);
	}, [onPlacedThreadIds, placedThreadIds]);

	useEffect(() => {
		if (original.review?.focus && placedThreadIds.has(original.review.focus.id)) {
			setActiveSide("base");
			return;
		}
		if (modified.review?.focus && placedThreadIds.has(modified.review.focus.id)) {
			setActiveSide("worktree");
		}
	}, [modified.review?.focus, original.review?.focus, placedThreadIds]);

	const selectMode = (next: VisualDiffMode) => {
		setMode(next);
		onViewState?.({ mode: next });
	};
	const updateDivider = (clientX: number) => {
		const bounds = layeredRef.current?.getBoundingClientRect();
		if (!bounds || bounds.width <= 0) return;
		setDivider(Math.min(100, Math.max(0, ((clientX - bounds.left) / bounds.width) * 100)));
	};
	const style = frameStyle(active.intrinsicSize, 68);

	return (
		<div
			data-testid={`${prefix}-diff`}
			className="flex h-full min-h-0 flex-col bg-container-content-bg"
		>
			{availableModes.length > 1 ? (
				<div className="flex shrink-0 flex-wrap items-center gap-4 border-border-default border-b bg-container-header-bg px-8 py-4">
					<div data-testid="image-diff-mode" className="flex items-center gap-2">
						{availableModes.map((candidate) => (
							<ToggleSegment
								key={candidate.mode}
								testid={`${prefix}-diff-${candidate.mode}`}
								label={candidate.label}
								active={mode === candidate.mode}
								onClick={() => selectMode(candidate.mode)}
							/>
						))}
					</div>
					{mode !== "2-up" ? (
						<div data-testid={`${prefix}-diff-side`} className="ml-auto flex items-center gap-2">
							<ToggleSegment
								testid={`${prefix}-diff-side-base`}
								label="Comment on old"
								active={activeSide === "base"}
								onClick={() => setActiveSide("base")}
							/>
							<ToggleSegment
								testid={`${prefix}-diff-side-worktree`}
								label="Comment on new"
								active={activeSide === "worktree"}
								onClick={() => setActiveSide("worktree")}
							/>
						</div>
					) : null}
				</div>
			) : null}
			<div className="min-h-0 flex-1 overflow-auto p-12">
				{mode === "2-up" ? (
					<div className="grid min-h-full grid-cols-1 gap-12 md:grid-cols-2">
						<SideSurface
							label="Old"
							selectionKey={`${regionLabel}:base`}
							side={original}
							regionLabel={regionLabel}
							contentStamp={contentStamp}
							emptyLabel={emptyLabel}
						/>
						<SideSurface
							label="New"
							selectionKey={`${regionLabel}:worktree`}
							side={modified}
							regionLabel={regionLabel}
							contentStamp={contentStamp}
							emptyLabel={emptyLabel}
						/>
					</div>
				) : (
					<div className="flex min-h-full flex-col gap-8">
						<RegionReviewSurface
							key={activeSide}
							{...(active.present ? { review: active.review } : {})}
							intrinsicSize={active.intrinsicSize}
							contentStamp={contentStamp}
							selectionKey={`${regionLabel}:${activeSide}`}
							{...(inactive.present && inactive.review
								? {
										additionalReviews: [
											{
												review: inactive.review,
												intrinsicSize: inactive.intrinsicSize,
											},
										],
									}
								: {})}
							className={frameClass(active.intrinsicSize, 68, mode !== "difference")}
							{...(style ? { style } : {})}
							label={regionLabel}
							{...(active.draftForRegion ? { draftForRegion: active.draftForRegion } : {})}
						>
							<div ref={layeredRef} className="relative h-full w-full">
								{original.present ? original.content : <EmptyFrame label={emptyLabel} />}
								<div
									className={`absolute inset-0 ${mode === "difference" ? "mix-blend-difference" : ""}`}
									style={
										mode === "swipe"
											? { clipPath: `inset(0 ${100 - divider}% 0 0)` }
											: mode === "onion"
												? { opacity: opacity / 100 }
												: undefined
									}
								>
									{modified.present ? modified.content : <EmptyFrame label={emptyLabel} />}
								</div>
								{mode === "swipe" ? (
									<button
										type="button"
										aria-label={`Move ${noun} comparison divider`}
										className="absolute inset-y-0 z-20 w-4 -translate-x-1/2 cursor-col-resize bg-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
										style={{ left: `${divider}%` }}
										onPointerDown={(event) => {
											event.currentTarget.setPointerCapture(event.pointerId);
											updateDivider(event.clientX);
										}}
										onPointerMove={(event) => {
											if (event.currentTarget.hasPointerCapture(event.pointerId)) {
												updateDivider(event.clientX);
											}
										}}
									/>
								) : null}
							</div>
						</RegionReviewSurface>
						{mode === "onion" ? (
							<label className="flex items-center gap-8 tr-text-metadata text-text-muted">
								New {noun} opacity
								<input
									type="range"
									min={0}
									max={100}
									value={opacity}
									onChange={(event) => setOpacity(event.currentTarget.valueAsNumber)}
									className="accent-primary"
								/>
								{opacity}%
							</label>
						) : null}
					</div>
				)}
			</div>
			<div className="grid shrink-0 grid-cols-1 gap-4 border-border-default border-t bg-container-header-bg px-12 py-4 tr-text-metadata text-text-muted md:grid-cols-2">
				<span>{original.caption}</span>
				<span>{modified.caption}</span>
			</div>
		</div>
	);
}
