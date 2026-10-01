import {
	RiFocus3Line as Fit,
	RiZoomInLine as ZoomIn,
	RiZoomOutLine as ZoomOut,
} from "@remixicon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ResourceViewProps } from "@/resources";
import { RegionReviewSurface } from "../RegionReviewSurface";
import { placedRegionThreadIds, type Size } from "../regionReview";
import { contentStamp } from "../reviewComposerState";
import {
	clampImageZoom,
	formatByteLength,
	imageSourceUrl,
	imageViewState,
	nextWheelZoom,
} from "./imageState";

const NO_THREADS: ReadonlySet<string> = new Set();

export default function ImageView({
	resource,
	content,
	review,
	onPlacedThreadIds,
	viewState,
	onViewState,
}: ResourceViewProps) {
	const initial = imageViewState(viewState);
	const [mode, setMode] = useState<"fit" | "zoom">(initial.mode);
	const [zoom, setZoom] = useState(initial.zoom);
	const stamp = contentStamp(content);
	const identity = content.kind === "bytes" ? JSON.stringify([stamp, content.url]) : stamp;
	const identityRef = useRef(identity);
	identityRef.current = identity;
	const [loaded, setLoaded] = useState<{ identity: string; size: Size } | null>(null);
	const natural = loaded?.identity === identity ? loaded.size : null;
	const source = content.kind === "bytes" ? imageSourceUrl(content.url, content.hash) : null;
	const placed = useMemo(
		() =>
			content.kind === "bytes" ? placedRegionThreadIds(review?.threads ?? [], natural) : NO_THREADS,
		[content.kind, natural, review?.threads],
	);

	useEffect(() => {
		setLoaded((current) => (current?.identity === identity ? current : null));
	}, [identity]);

	useEffect(() => {
		onPlacedThreadIds?.(placed);
		return () => onPlacedThreadIds?.(NO_THREADS);
	}, [onPlacedThreadIds, placed]);

	if (content.kind !== "bytes") {
		return (
			<div
				data-testid="image-view"
				className="flex h-full items-center justify-center bg-container-workspace-bg tr-text-ui text-text-muted"
			>
				No image
			</div>
		);
	}

	const updateView = (nextMode: "fit" | "zoom", nextZoom: number) => {
		const bounded = clampImageZoom(nextZoom);
		setMode(nextMode);
		setZoom(bounded);
		onViewState?.({ mode: nextMode, zoom: bounded });
	};
	const zoomBy = (factor: number) => updateView("zoom", zoom * factor);
	const dimensions = natural ? `${natural.width} × ${natural.height}` : "Loading dimensions";
	const mediaStyle =
		mode === "zoom" && natural
			? { width: natural.width * zoom, height: natural.height * zoom }
			: undefined;

	return (
		<div
			data-testid="image-view"
			className="flex h-full min-h-0 flex-col bg-container-workspace-bg"
		>
			<div className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-8">
				<Button
					variant="ghost"
					size="icon"
					aria-label="Fit image"
					data-testid="image-fit"
					onClick={() => updateView("fit", zoom)}
				>
					<Fit className="size-14" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Show image at actual size"
					data-testid="image-actual-size"
					onClick={() => updateView("zoom", 1)}
				>
					<span className="tr-text-action">1:1</span>
				</Button>
				<Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
					<ZoomOut className="size-14" />
				</Button>
				<span className="min-w-40 text-center tr-text-metadata text-text-muted">
					{Math.round(zoom * 100)}%
				</span>
				<Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
					<ZoomIn className="size-14" />
				</Button>
				<span className="ml-auto tr-text-metadata text-text-muted">
					{dimensions} · {formatByteLength(resource.byteLength ?? content.byteLength)}
				</span>
			</div>
			<div
				className="min-h-0 flex-1 overflow-auto p-16"
				onWheel={(event) => {
					if (event.deltaY === 0) return;
					event.preventDefault();
					updateView("zoom", nextWheelZoom(zoom, event.deltaY));
				}}
			>
				<div className="flex min-h-full min-w-full items-center justify-center">
					<RegionReviewSurface
						review={review}
						intrinsicSize={natural}
						contentStamp={stamp}
						testid="image-region-surface"
						className={mode === "fit" ? "w-fit max-w-full" : "w-fit max-w-none"}
						{...(mediaStyle ? { style: mediaStyle } : {})}
					>
						<img
							key={identity}
							src={source ?? undefined}
							alt={resource.path}
							data-testid="image-resource"
							className={
								mode === "fit"
									? "block max-h-[70vh] max-w-full object-contain"
									: "block h-full w-full max-w-none"
							}
							draggable={false}
							onLoad={(event) => {
								if (identityRef.current !== identity) return;
								const size = {
									width: event.currentTarget.naturalWidth,
									height: event.currentTarget.naturalHeight,
								};
								setLoaded(size.width > 0 && size.height > 0 ? { identity, size } : null);
							}}
							onError={() => {
								if (identityRef.current === identity) setLoaded(null);
							}}
						/>
					</RegionReviewSurface>
				</div>
			</div>
		</div>
	);
}
