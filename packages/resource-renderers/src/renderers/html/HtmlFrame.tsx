import { cn } from "@thinkrail/ui/utils";
import { type CSSProperties, type SyntheticEvent, useEffect, useRef } from "react";
import { useElementSize } from "../../support/useElementSize";
import type { ScrollLink } from "./scrollLink";
import { type HtmlViewport, htmlFrameGeometry } from "./viewport";

const NO_BOX = { width: 0, height: 0 };

export function HtmlFrame({
	title,
	document,
	viewport = "responsive",
	scrollLink,
	compact = false,
}: {
	title: string;
	document: string;
	viewport?: HtmlViewport;
	scrollLink?: ScrollLink | undefined;
	compact?: boolean;
}) {
	const { ref: boxRef, size } = useElementSize<HTMLDivElement>();
	const detachRef = useRef<(() => void) | null>(null);
	useEffect(
		() => () => {
			detachRef.current?.();
			detachRef.current = null;
		},
		[],
	);
	const box = size ?? NO_BOX;
	const geometry = htmlFrameGeometry(viewport, box);
	const fitted = viewport !== "responsive" && box.width > 0;
	const vars = {
		"--html-frame-width": `${geometry.width}px`,
		"--html-frame-height": `${geometry.height}px`,
		"--html-frame-scale": String(geometry.scale),
	} as CSSProperties;
	const linkOnLoad = scrollLink
		? (event: SyntheticEvent<HTMLIFrameElement>) => {
				detachRef.current?.();
				const view = event.currentTarget.contentWindow;
				detachRef.current = view ? scrollLink.attach(view) : null;
			}
		: undefined;

	return (
		<div
			ref={boxRef}
			data-testid="html-frame-box"
			data-viewport={viewport}
			data-scale={geometry.scale.toFixed(3)}
			className={cn(
				"relative h-full w-full overflow-hidden",
				compact ? "min-h-0" : "min-h-[360px]",
			)}
			style={fitted ? vars : undefined}
		>
			<iframe
				title={title}
				sandbox={scrollLink ? "allow-same-origin" : ""}
				srcDoc={document}
				onLoad={linkOnLoad}
				className={
					fitted
						? "absolute top-0 left-0 h-[var(--html-frame-height)] w-[var(--html-frame-width)] max-w-none origin-top-left scale-[var(--html-frame-scale)] border-0 bg-container-workspace-bg"
						: "absolute inset-0 h-full w-full border-0 bg-container-workspace-bg"
				}
			/>
		</div>
	);
}
