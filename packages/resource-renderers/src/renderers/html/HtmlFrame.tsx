import { cn } from "@thinkrail/ui/utils";
import type { CSSProperties, Ref } from "react";
import { useElementSize } from "../../support/useElementSize";
import { type HtmlViewport, htmlFitGeometry, htmlFrameGeometry } from "./viewport";

const NO_BOX = { width: 0, height: 0 };

export function HtmlFrame({
	title,
	document,
	viewport = "responsive",
	sandbox = "",
	frameRef,
	onLoad,
	contentHeight,
}: {
	title: string;
	document: string;
	viewport?: HtmlViewport;
	sandbox?: "" | "allow-scripts";
	frameRef?: Ref<HTMLIFrameElement>;
	onLoad?: () => void;
	contentHeight?: number | null;
}) {
	const { ref: boxRef, size } = useElementSize<HTMLDivElement>();
	const box = size ?? NO_BOX;
	const fit = contentHeight !== undefined;
	const geometry = fit
		? htmlFitGeometry(viewport, box.width, contentHeight)
		: htmlFrameGeometry(viewport, box);
	const scaled = viewport !== "responsive" && box.width > 0;
	const sized = scaled || fit;
	const vars = {
		"--html-frame-width": scaled ? `${geometry.width}px` : "100%",
		"--html-frame-height": `${geometry.height}px`,
		"--html-frame-scale": String(geometry.scale),
		"--html-box-height": `${geometry.height * geometry.scale}px`,
	} as CSSProperties;

	return (
		<div
			ref={boxRef}
			data-testid="html-frame-box"
			data-viewport={viewport}
			data-scale={geometry.scale.toFixed(3)}
			data-content-height={fit ? geometry.height : undefined}
			className={cn(
				"relative w-full overflow-hidden",
				fit ? "h-[var(--html-box-height)]" : "h-full min-h-[360px]",
			)}
			style={sized ? vars : undefined}
		>
			<iframe
				ref={frameRef}
				title={title}
				sandbox={sandbox}
				srcDoc={document}
				onLoad={onLoad}
				className={
					sized
						? "absolute top-0 left-0 h-[var(--html-frame-height)] w-[var(--html-frame-width)] max-w-none origin-top-left scale-[var(--html-frame-scale)] border-0 bg-container-workspace-bg"
						: "absolute inset-0 h-full w-full border-0 bg-container-workspace-bg"
				}
			/>
		</div>
	);
}
