import { useEffect, useMemo } from "react";
import type { ResourceViewProps } from "@/resources";
import { RegionReviewSurface } from "../RegionReviewSurface";
import { placedRegionThreadIds } from "../regionReview";
import { contentStamp } from "../reviewComposerState";
import { SvgFrame } from "./SvgFrame";
import { buildSvgDocument, svgByteLength, svgFileDraft, svgIntrinsicSize } from "./svgDocument";
import { useSvgTheme } from "./useSvgTheme";

const NO_THREADS: ReadonlySet<string> = new Set();

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
	const aspect = size ? size.width / size.height : null;
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
			<div className="min-h-0 flex-1 overflow-auto p-16">
				<RegionReviewSurface
					review={review}
					intrinsicSize={size}
					contentStamp={stamp}
					className={`${aspect ? "mx-auto w-full" : "h-[min(72vh,760px)] w-full"} min-h-40 max-w-[960px] border border-border-muted bg-container-workspace-bg`}
					{...(aspect ? { style: { aspectRatio: aspect } } : {})}
					label="file"
					draftForRegion={svgFileDraft}
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
