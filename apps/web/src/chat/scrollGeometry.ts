export type RevealBlock = "start" | "nearest";

export interface RevealScrollGeometry {
	scrollTop: number;
	maxScrollTop: number;
	viewportTop: number;
	viewportBottom: number;
	targetTop: number;
	targetBottom: number;
}

function clampScrollTop(scrollTop: number, maxScrollTop: number): number {
	return Math.min(Math.max(0, maxScrollTop), Math.max(0, scrollTop));
}

export function revealScrollTop(geometry: RevealScrollGeometry, block: RevealBlock): number {
	const { scrollTop, maxScrollTop, viewportTop, viewportBottom, targetTop, targetBottom } =
		geometry;
	let destination = scrollTop;

	if (block === "start") {
		destination += targetTop - viewportTop;
	} else if (targetTop < viewportTop && targetBottom < viewportBottom) {
		destination += targetTop - viewportTop;
	} else if (targetBottom > viewportBottom && targetTop > viewportTop) {
		destination += targetBottom - viewportBottom;
	}

	return clampScrollTop(destination, maxScrollTop);
}
