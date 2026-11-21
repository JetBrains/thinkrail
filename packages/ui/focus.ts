export const TABBABLE_SELECTOR = [
	"button:not(:disabled)",
	"a[href]",
	"input:not(:disabled)",
	"select:not(:disabled)",
	"textarea:not(:disabled)",
	'[contenteditable="true"]',
	"details > summary:first-of-type",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

export function focusFirstControl(container: Element): boolean {
	const control = container.querySelector<HTMLElement>(TABBABLE_SELECTOR);
	control?.focus({ preventScroll: true });
	return control !== null;
}

interface Span {
	readonly top: number;
	readonly bottom: number;
}

export function revealDelta(view: Span, target: Span): number {
	if (target.top < view.top) return target.top - view.top;
	if (target.bottom > view.bottom) {
		return Math.min(target.bottom - view.bottom, target.top - view.top);
	}
	return 0;
}

export function scrollsVertically(element: Element): boolean {
	const { overflowY } = getComputedStyle(element);
	return (
		(overflowY === "auto" || overflowY === "scroll") &&
		element.scrollHeight > element.clientHeight + 1
	);
}

export function scrollsHorizontally(element: Element): boolean {
	const { overflowX } = getComputedStyle(element);
	return (
		(overflowX === "auto" || overflowX === "scroll") &&
		element.scrollWidth > element.clientWidth + 1
	);
}

function outlineExtent(element: Element): number {
	const { outlineStyle, outlineWidth, outlineOffset } = getComputedStyle(element);
	if (outlineStyle === "none") return 0;
	return Math.max(
		0,
		(Number.parseFloat(outlineWidth) || 0) + (Number.parseFloat(outlineOffset) || 0),
	);
}

export function focusAndReveal(element: HTMLElement): void {
	element.focus({ preventScroll: true });
	let scroller = element.parentElement;
	while (scroller && !scrollsVertically(scroller)) scroller = scroller.parentElement;
	if (!scroller) return;
	const top = scroller.getBoundingClientRect().top + scroller.clientTop;
	const box = element.getBoundingClientRect();
	const ring = outlineExtent(element);
	scroller.scrollTop += revealDelta(
		{ top, bottom: top + scroller.clientHeight },
		{ top: box.top - ring, bottom: box.bottom + ring },
	);
}

export function revealHorizontally(element: HTMLElement): void {
	let scroller = element.parentElement;
	while (scroller && !scrollsHorizontally(scroller)) scroller = scroller.parentElement;
	if (!scroller) return;
	const left = scroller.getBoundingClientRect().left + scroller.clientLeft;
	const box = element.getBoundingClientRect();
	const ring = outlineExtent(element);
	scroller.scrollLeft += revealDelta(
		{ top: left, bottom: left + scroller.clientWidth },
		{ top: box.left - ring, bottom: box.right + ring },
	);
}
