import { type CSSProperties, useEffect, useRef, useState } from "react";
import { type HtmlViewport, htmlFrameGeometry } from "./viewport";

export function HtmlFrame({
	title,
	document,
	viewport = "responsive",
}: {
	title: string;
	document: string;
	viewport?: HtmlViewport;
}) {
	const boxRef = useRef<HTMLDivElement>(null);
	const [box, setBox] = useState({ width: 0, height: 0 });

	useEffect(() => {
		const element = boxRef.current;
		if (!element) return;
		const measure = () => {
			const { width, height } = element.getBoundingClientRect();
			setBox((current) =>
				current.width === width && current.height === height ? current : { width, height },
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

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
