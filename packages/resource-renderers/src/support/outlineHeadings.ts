import { useLayoutEffect, useState } from "react";
import { openDetailsAround, type StampedHeading, stampedHeadings } from "./sourceLines";

export const MARKDOWN_OUTLINE_NARROW_WIDTH = 720;

export interface OutlineNode {
	index: number;
	text: string;
	children: OutlineNode[];
}

export function nestOutlineHeadings(
	headings: readonly Pick<StampedHeading, "depth" | "text">[],
): OutlineNode[] {
	const root: OutlineNode[] = [];
	const stack: { depth: number; node: OutlineNode }[] = [];
	headings.forEach((heading, index) => {
		const node: OutlineNode = { index, text: heading.text, children: [] };
		while ((stack.at(-1)?.depth ?? 0) >= heading.depth) stack.pop();
		(stack.at(-1)?.node.children ?? root).push(node);
		stack.push({ depth: heading.depth, node });
	});
	return root;
}

function sameHeadings(a: readonly StampedHeading[], b: readonly StampedHeading[]): boolean {
	return (
		a.length === b.length &&
		a.every((heading, i) => {
			const other = b[i];
			return (
				other !== undefined &&
				heading.element === other.element &&
				heading.line === other.line &&
				heading.depth === other.depth &&
				heading.text === other.text &&
				heading.hidden === other.hidden
			);
		})
	);
}

const NO_HEADINGS: readonly StampedHeading[] = [];

export function useStampedHeadings(container: HTMLElement | null): readonly StampedHeading[] {
	const [headings, setHeadings] = useState(NO_HEADINGS);
	useLayoutEffect(() => {
		if (!container) return;
		const collect = () => {
			const next = stampedHeadings(container);
			setHeadings((current) => (sameHeadings(current, next) ? current : next));
		};
		collect();
		const observer = new MutationObserver(collect);
		observer.observe(container, {
			childList: true,
			subtree: true,
			characterData: true,
			attributeFilter: ["data-md-line-start", "open"],
		});
		return () => observer.disconnect();
	}, [container]);
	return container ? headings : NO_HEADINGS;
}

export function lastElementAtTop(top: number, elements: readonly HTMLElement[]): number {
	let lo = 0;
	let hi = elements.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const element = elements[mid];
		if (!element) break;
		if (element.getBoundingClientRect().top - top <= 1) {
			found = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return found;
}

export function scrollToHeading(scroller: HTMLElement, heading: HTMLElement): void {
	openDetailsAround(heading, scroller);
	const top =
		heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	scroller.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
}

export function revealInList(list: HTMLElement, entry: HTMLElement): void {
	const listRect = list.getBoundingClientRect();
	const entryRect = entry.getBoundingClientRect();
	if (entryRect.top < listRect.top) list.scrollTop -= listRect.top - entryRect.top;
	else if (entryRect.bottom > listRect.bottom) list.scrollTop += entryRect.bottom - listRect.bottom;
}
