export type RevealBlock = "start" | "nearest";

export interface RevealScrollGeometry {
	scrollTop: number;
	maxScrollTop: number;
	viewportTop: number;
	viewportBottom: number;
	topInset?: number;
	targetTop: number;
	targetBottom: number;
}

function clampScrollTop(scrollTop: number, maxScrollTop: number): number {
	return Math.min(Math.max(0, maxScrollTop), Math.max(0, scrollTop));
}

export function estimatedRowTop(
	heights: readonly number[],
	anchorIndex: number,
	anchorTop: number,
	targetIndex: number,
): number {
	let top = anchorTop;
	if (targetIndex > anchorIndex) {
		for (let index = anchorIndex; index < targetIndex; index += 1) {
			top += heights[index] ?? 0;
		}
	} else {
		for (let index = targetIndex; index < anchorIndex; index += 1) {
			top -= heights[index] ?? 0;
		}
	}
	return top;
}

export function alignedRowScrollTop(
	rowTop: number,
	rowHeight: number,
	viewportHeight: number,
	align: "start" | "center" | "end",
): number {
	if (align === "start") return rowTop;
	if (align === "end") return rowTop + rowHeight - viewportHeight;
	return rowTop + rowHeight / 2 - viewportHeight / 2;
}

export function revealScrollTop(geometry: RevealScrollGeometry, block: RevealBlock): number {
	const {
		scrollTop,
		maxScrollTop,
		viewportTop,
		viewportBottom,
		topInset = 0,
		targetTop,
		targetBottom,
	} = geometry;
	const contentTop = viewportTop + topInset;
	let destination = scrollTop;

	if (block === "start") {
		destination += targetTop - contentTop;
	} else {
		const viewportHeight = viewportBottom - contentTop;
		const targetHeight = targetBottom - targetTop;
		if (targetTop < contentTop && targetBottom < viewportBottom) {
			destination +=
				targetHeight > viewportHeight ? targetBottom - viewportBottom : targetTop - contentTop;
		} else if (targetBottom > viewportBottom && targetTop > contentTop) {
			destination +=
				targetHeight > viewportHeight ? targetTop - contentTop : targetBottom - viewportBottom;
		}
	}

	return clampScrollTop(destination, maxScrollTop);
}
