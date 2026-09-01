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
	} else {
		const viewportHeight = viewportBottom - viewportTop;
		const targetHeight = targetBottom - targetTop;
		if (targetTop < viewportTop && targetBottom < viewportBottom) {
			destination +=
				targetHeight > viewportHeight ? targetBottom - viewportBottom : targetTop - viewportTop;
		} else if (targetBottom > viewportBottom && targetTop > viewportTop) {
			destination +=
				targetHeight > viewportHeight ? targetTop - viewportTop : targetBottom - viewportBottom;
		}
	}

	return clampScrollTop(destination, maxScrollTop);
}
