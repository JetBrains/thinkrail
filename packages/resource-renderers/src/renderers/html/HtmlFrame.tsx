import type { CSSProperties } from "react";
import { useElementSize } from "../../support/useElementSize";
import { type HtmlViewport, htmlFrameGeometry } from "./viewport";

const NO_BOX = { width: 0, height: 0 };

export function HtmlFrame({
	title,
	document,
	viewport = "responsive",
}: {
	title: string;
	document: string;
	viewport?: HtmlViewport;
}) {
	const { ref: boxRef, size } = useElementSize<HTMLDivElement>();
	const box = size ?? NO_BOX;
	const geometry = htmlFrameGeometry(viewport, box);
	const fitted = viewport !== "responsive" && box.width > 0;
	const vars = {
		"--html-frame-width": `${geometry.width}px`,
		"--html-frame-height": `${geometry.height}px`,
		"--html-frame-scale": String(geometry.scale),
	} as CSSProperties;

	return (
		<div
			ref={boxRef}
			data-testid="html-frame-box"
			data-viewport={viewport}
			data-scale={geometry.scale.toFixed(3)}
			className="relative h-full min-h-[360px] w-full overflow-hidden"
			style={fitted ? vars : undefined}
		>
			<iframe
				title={title}
				sandbox=""
				srcDoc={document}
				className={
					fitted
						? "absolute top-0 left-0 h-[var(--html-frame-height)] w-[var(--html-frame-width)] max-w-none origin-top-left scale-[var(--html-frame-scale)] border-0 bg-container-workspace-bg"
						: "absolute inset-0 h-full w-full border-0 bg-container-workspace-bg"
				}
			/>
		</div>
	);
}
