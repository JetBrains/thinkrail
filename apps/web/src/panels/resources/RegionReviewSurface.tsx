import { RiChatNewLine as MessageSquarePlus } from "@remixicon/react";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import {
	type CSSProperties,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { AnchorDraft, SurfaceReview } from "@/resources";
import { ReviewComposer } from "../ReviewComposer";
import { ReviewThreadCard } from "../ReviewThreadCard";
import {
	containedMediaRect,
	denormalizeRegion,
	normalizeRegion,
	type Rect,
	type Region,
	regionDraft,
	regionOfAnchor,
	type Size,
} from "./regionReview";
import { useStampedComposer } from "./reviewComposerState";
import { StaleComposerNotice } from "./StaleComposerNotice";

interface DragState {
	pointerId: number;
	stamp: string;
	start: { x: number; y: number };
}

export interface RegionReviewProjection {
	review: SurfaceReview;
	intrinsicSize: Size | null;
}

function regionStyle(region: Region, bounds: Rect): CSSProperties {
	const rect = denormalizeRegion(region, bounds);
	return {
		left: rect.x,
		top: rect.y,
		width: rect.width,
		height: rect.height,
	};
}

export function RegionReviewSurface({
	review,
	intrinsicSize,
	contentStamp,
	children,
	className,
	style,
	testid,
	label = "image",
	draftForRegion = regionDraft,
	additionalReviews = [],
}: {
	review?: SurfaceReview | undefined;
	intrinsicSize: Size | null;
	contentStamp: string;
	additionalReviews?: readonly RegionReviewProjection[] | undefined;
	children: ReactNode;
	className?: string | undefined;
	style?: CSSProperties | undefined;
	testid?: string | undefined;
	label?: string | undefined;
	draftForRegion?: ((region: Region) => AnchorDraft) | undefined;
}) {
	const [drag, setDrag] = useState<DragState | null>(null);
	const composer = useStampedComposer<Region>(contentStamp);
	const cardsRef = useRef(new Map<string, HTMLDivElement>());
	const mediaRef = useRef<HTMLDivElement>(null);
	const handledFocusRef = useRef<string | null>(null);
	const [frame, setFrame] = useState<Rect | null>(null);

	useEffect(() => {
		const element = mediaRef.current;
		if (!element) return;
		const measure = () => {
			const bounds = element.getBoundingClientRect();
			setFrame((current) => {
				if (current?.width === bounds.width && current.height === bounds.height) return current;
				return { x: 0, y: 0, width: bounds.width, height: bounds.height };
			});
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (drag && drag.stamp !== contentStamp) setDrag(null);
	}, [contentStamp, drag]);

	const projections = useMemo<readonly RegionReviewProjection[]>(
		() => [...(review ? [{ review, intrinsicSize }] : []), ...additionalReviews],
		[additionalReviews, intrinsicSize, review],
	);
	const mappedProjections = useMemo(
		() =>
			projections.flatMap((projection) => {
				const bounds = frame ? containedMediaRect(projection.intrinsicSize, frame) : null;
				return bounds ? [{ ...projection, bounds }] : [];
			}),
		[frame, projections],
	);
	const primaryBounds = frame ? containedMediaRect(intrinsicSize, frame) : null;
	const threads = useMemo(
		() =>
			mappedProjections.flatMap(({ review: surface, bounds }) =>
				surface.threads.flatMap((thread) => {
					const region = regionOfAnchor(thread.anchor);
					return region ? [{ thread, region, surface, bounds }] : [];
				}),
			),
		[mappedProjections],
	);
	const focusedSurface = mappedProjections.find(
		({ review: surface }) =>
			surface.focus && threads.some(({ thread }) => thread.id === surface.focus?.id),
	)?.review;
	const focusId = focusedSurface?.focus?.id ?? null;

	useEffect(() => {
		if (!focusId) {
			handledFocusRef.current = null;
			return;
		}
		if (handledFocusRef.current === focusId) return;
		const card = cardsRef.current.get(focusId);
		if (!card || !threads.some(({ thread }) => thread.id === focusId)) return;
		handledFocusRef.current = focusId;
		card.scrollIntoView({ block: "center" });
		focusedSurface?.onFocusHandled();
	}, [focusId, focusedSurface, threads]);

	const regionAtPointer = (event: ReactPointerEvent<HTMLDivElement>, start: DragState["start"]) => {
		const frameBounds = event.currentTarget.getBoundingClientRect();
		const mediaBounds = containedMediaRect(intrinsicSize, {
			x: frameBounds.left,
			y: frameBounds.top,
			width: frameBounds.width,
			height: frameBounds.height,
		});
		return mediaBounds
			? normalizeRegion(start, { x: event.clientX, y: event.clientY }, mediaBounds)
			: null;
	};
	const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (
			!review ||
			!primaryBounds ||
			event.button !== 0 ||
			(event.target as Element).closest("button")
		) {
			return;
		}
		event.currentTarget.setPointerCapture(event.pointerId);
		const start = { x: event.clientX, y: event.clientY };
		const region = regionAtPointer(event, start);
		if (!region) return;
		setDrag({ pointerId: event.pointerId, stamp: contentStamp, start });
		composer.select(region, false);
	};
	const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!drag || drag.pointerId !== event.pointerId || drag.stamp !== contentStamp) return;
		const region = regionAtPointer(event, drag.start);
		if (region) composer.select(region, false);
	};
	const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!drag || drag.pointerId !== event.pointerId || drag.stamp !== contentStamp) return;
		const next = regionAtPointer(event, drag.start);
		setDrag(null);
		if (next && next.width > 0.002 && next.height > 0.002) composer.select(next, false);
		else composer.close();
	};
	const scrollToCard = (id: string) =>
		cardsRef.current.get(id)?.scrollIntoView({ block: "center" });
	const selectionDraft = composer.selection ? draftForRegion(composer.selection) : null;

	return (
		<div className="flex min-w-0 flex-col gap-8">
			<div
				ref={mediaRef}
				data-testid={testid}
				className={cn("relative isolate shrink-0", className)}
				style={style}
			>
				{children}
				{mappedProjections.length > 0 ? (
					<div
						className="absolute inset-0 z-10 touch-none select-none"
						onPointerDown={startDrag}
						onPointerMove={moveDrag}
						onPointerUp={finishDrag}
						onPointerCancel={() => {
							setDrag(null);
							composer.close();
						}}
					>
						{threads.map(({ thread, region, bounds }, index) => (
							<div
								key={thread.id}
								className="pointer-events-none absolute border-2 border-primary"
								style={regionStyle(region, bounds)}
							>
								<button
									type="button"
									aria-label={`Show comment ${index + 1}`}
									data-testid="region-comment-marker"
									className="pointer-events-auto absolute -top-12 -right-12 flex size-24 items-center justify-center rounded-full bg-primary tr-text-action text-text-on-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
									onPointerDown={(event) => event.stopPropagation()}
									onClick={() => scrollToCard(thread.id)}
								>
									{index + 1}
								</button>
							</div>
						))}
						{composer.selection && primaryBounds ? (
							<div
								data-testid="region-selection"
								className="pointer-events-none absolute border-2 border-primary bg-primary-subtle"
								style={regionStyle(composer.selection, primaryBounds)}
							>
								{!drag && !composer.composing ? (
									<IconTooltip label={`Comment on this ${label}`}>
										<button
											type="button"
											data-testid="review-add-icon"
											aria-label={`Comment on this ${label}`}
											className="pointer-events-auto absolute -right-12 -bottom-12 flex size-24 items-center justify-center rounded-[var(--radius-sm)] bg-primary text-text-on-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
											onPointerDown={(event) => event.stopPropagation()}
											onClick={composer.open}
										>
											<MessageSquarePlus className="size-14" />
										</button>
									</IconTooltip>
								) : null}
							</div>
						) : null}
					</div>
				) : null}
			</div>
			<StaleComposerNotice visible={composer.stale} />
			{composer.composing && selectionDraft && review ? (
				<ReviewComposer
					draft={selectionDraft}
					label={selectionDraft.label}
					commenting={review.commenting}
					onClose={composer.close}
					className="review-composer-flow"
				/>
			) : null}
			{threads.length > 0 ? (
				<div data-testid="region-thread-list" className="flex flex-col gap-4">
					{threads.map(({ thread, surface }) => (
						<div
							key={thread.id}
							ref={(node) => {
								if (node) cardsRef.current.set(thread.id, node);
								else cardsRef.current.delete(thread.id);
							}}
						>
							<ReviewThreadCard
								thread={thread}
								actions={surface.actions}
								onActivate={() => mediaRef.current?.scrollIntoView({ block: "center" })}
							/>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
