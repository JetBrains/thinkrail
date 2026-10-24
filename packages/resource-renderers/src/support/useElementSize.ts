import { useLayoutEffect, useState } from "react";

export interface ElementSize {
	width: number;
	height: number;
}

function borderBox(element: HTMLElement): ElementSize {
	const { width, height } = element.getBoundingClientRect();
	return { width, height };
}

function contentBox(element: HTMLElement): ElementSize {
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

export function useElementSize<T extends HTMLElement>(box: "border" | "content" = "border") {
	const [element, setElement] = useState<T | null>(null);
	const [size, setSize] = useState<ElementSize | null>(null);
	useLayoutEffect(() => {
		if (!element) return;
		const measure = () => {
			const next = box === "content" ? contentBox(element) : borderBox(element);
			setSize((current) =>
				current?.width === next.width && current.height === next.height ? current : next,
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [element, box]);
	return { ref: setElement, element, size };
}
