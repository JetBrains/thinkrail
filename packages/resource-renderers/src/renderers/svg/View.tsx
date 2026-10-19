import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { ResourceViewProps } from "../../registry";
import { RegionReviewSurface } from "../RegionReviewSurface";
import { containedMediaRect, placedRegionThreadIds } from "../regionReview";
import { contentStamp } from "../reviewComposerState";
import { SvgFrame } from "./SvgFrame";
import { buildSvgDocument, svgByteLength, svgIntrinsicSize } from "./svgDocument";
import { useSvgTheme } from "./useSvgTheme";

const NO_THREADS: ReadonlySet<string> = new Set();
const MAX_WIDTH = 960;

function contentBox(element: HTMLElement): { width: number; height: number } {
	const style = getComputedStyle(element);
	return {
		width:
			element.clientWidth -
			Number.parseFloat(style.paddingLeft) -
			Number.parseFloat(style.paddingRight),
		height:
			element.clientHeight -
			Number.parseFloat(style.paddingTop) -
			Number.parseFloat(style.paddingBottom),
	};
}

function useContentBox() {
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const [box, setBox] = useState<{ width: number; height: number } | null>(null);
	useLayoutEffect(() => {
		if (!element) return;
		const measure = () => {
			const next = contentBox(element);
			setBox((current) =>
				current?.width === next.width && current.height === next.height ? current : next,
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	return [setElement, box] as const;
}

export default function SvgView({
	resource,
	content,
	review,
	onPlacedThreadIds,
}: ResourceViewProps) {
	const text = content.kind === "text" ? content.text : null;
	const tokens = useSvgTheme(false);
	const document = useMemo(
		() => (text !== null && tokens ? buildSvgDocument(text, tokens) : null),
		[text, tokens],
	);
	const size = useMemo(() => (text === null ? null : svgIntrinsicSize(text)), [text]);
	const [contentRef, box] = useContentBox();
	const fitted = box
		? containedMediaRect(size, {
				x: 0,
				y: 0,
				width: Math.min(box.width, MAX_WIDTH),
				height: box.height,
			})
		: null;
	const stamp = contentStamp(content);
	const placed = useMemo(
		() => (text === null ? NO_THREADS : placedRegionThreadIds(review?.threads ?? [], size)),
		[review?.threads, size, text],
	);

	useEffect(() => {
		onPlacedThreadIds?.(placed);
		return () => onPlacedThreadIds?.(NO_THREADS);
	}, [onPlacedThreadIds, placed]);

	if (text === null || document === null) return null;

	return (
		<div data-testid="svg-view" className="flex h-full min-h-0 flex-col bg-container-workspace-bg">
			<div ref={contentRef} className="min-h-0 flex-1 overflow-auto p-16">
				<RegionReviewSurface
					review={review}
					intrinsicSize={size}
					contentStamp={stamp}
					testid="svg-region-surface"
					className={`${fitted ? "mx-auto h-[var(--svg-fit-height)] w-[var(--svg-fit-width)]" : "h-[min(72vh,760px)] w-full"} min-h-40 max-w-[960px] border border-border-muted bg-container-workspace-bg`}
					{...(fitted
						? {
								style: {
									"--svg-fit-width": `${fitted.width}px`,
									"--svg-fit-height": `${fitted.height}px`,
								} as CSSProperties,
							}
						: {})}
				>
					<SvgFrame title={`Vector preview of ${resource.path}`} document={document} />
				</RegionReviewSurface>
			</div>
			<div className="shrink-0 border-border-default border-t bg-container-header-bg px-12 py-4 tr-text-metadata text-text-muted">
				{size ? `${size.width} × ${size.height}` : "Flexible size"} · {svgByteLength(text)} B
			</div>
		</div>
	);
}
