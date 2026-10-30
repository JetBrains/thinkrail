import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { stripFrontmatter } from "./frontmatter";
import { DOCUMENT_ID_PREFIX } from "./markdownHtml";
import {
	collectMarkdownHeadings,
	type HeadingIdAssignment,
	type MarkdownHeading,
} from "./markdownLinks";

export const MARKDOWN_OUTLINE_NARROW_WIDTH = 720;

export interface OutlineHeading extends MarkdownHeading {
	children: OutlineHeading[];
}

export function nestOutlineHeadings(headings: readonly MarkdownHeading[]): OutlineHeading[] {
	const root: OutlineHeading[] = [];
	const stack: OutlineHeading[] = [];
	for (const heading of headings) {
		const node: OutlineHeading = { ...heading, children: [] };
		while ((stack.at(-1)?.depth ?? 0) >= node.depth) stack.pop();
		const parent = stack.at(-1);
		if (parent) parent.children.push(node);
		else root.push(node);
		stack.push(node);
	}
	return root;
}

export function flattenOutlineHeadings(
	nodes: readonly OutlineHeading[],
	nest = 0,
): { heading: OutlineHeading; nest: number }[] {
	return nodes.flatMap((heading) => [
		{ heading, nest },
		...flattenOutlineHeadings(heading.children, nest + 1),
	]);
}

function parseDocumentMarkdown(markdown: string) {
	return fromMarkdown(stripFrontmatter(markdown), {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()],
	});
}

export function extractMarkdownOutline(markdown: string): OutlineHeading[] {
	return nestOutlineHeadings(collectMarkdownHeadings(parseDocumentMarkdown(markdown)));
}

/**
 * Document-wide heading ids for one spliced segment, matched by source line rather than by ordinal so
 * a heading that only parses inside the segment (for example a setext underline split from its
 * paragraph) cannot shift the ids of the headings after it.
 */
export function headingIdsInSlice(
	headings: readonly OutlineHeading[],
	startLine0: number,
	text: string,
): HeadingIdAssignment {
	const flat = flattenOutlineHeadings(headings);
	const reserved = new Set(flat.map(({ heading }) => heading.id));
	const byLine = new Map<number, string>();
	if (!text) return { byLine, reserved };
	const start = startLine0 + 1;
	const end = startLine0 + text.split("\n").length;
	for (const { heading } of flat) {
		if (heading.line >= start && heading.line <= end)
			byLine.set(heading.line - startLine0, heading.id);
	}
	return { byLine, reserved };
}

export function headingElement(root: ParentNode, id: string): HTMLElement | null {
	for (const candidate of [`${DOCUMENT_ID_PREFIX}${id}`, id]) {
		const node = root.querySelector(`[id="${candidate}"]`);
		if (node) return node as HTMLElement;
	}
	return null;
}

// A heading inside a closed <details> has no layout, so open every closed ancestor up to the scroller
// before measuring; otherwise the preview scrolls but the selected section stays hidden.
export function openDetailsAncestors(scroller: HTMLElement, heading: HTMLElement): void {
	for (let node = heading.parentElement; node && node !== scroller; node = node.parentElement) {
		if (node.tagName === "DETAILS" && !node.hasAttribute("open")) node.setAttribute("open", "");
	}
}

export function scrollHeadingIntoView(scroller: HTMLElement, id: string): void {
	const heading = headingElement(scroller, id);
	if (!heading) return;
	openDetailsAncestors(scroller, heading);
	const top =
		heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
	scroller.scrollTo({ top, behavior: "smooth" });
}

/**
 * Heading elements for `ids`, in document order, skipping ids the preview has not rendered. Resolve
 * once per content change and reuse across scroll events instead of querying on every event.
 */
export function resolveHeadingElements(
	scroller: HTMLElement,
	ids: readonly string[],
): { id: string; element: HTMLElement }[] {
	return ids.flatMap((id) => {
		const element = headingElement(scroller, id);
		return element ? [{ id, element }] : [];
	});
}

/**
 * The last heading at or above the viewport top. Headings are in document order, so a binary search
 * reads O(log n) rects per call. Headings without layout (inside closed details) report a zero rect
 * and are skipped by searching only measurable entries.
 */
export function activeHeadingIdFromElements(
	scroller: HTMLElement,
	headings: readonly { id: string; element: HTMLElement }[],
	fallback: string | null,
): string | null {
	const viewportTop = scroller.getBoundingClientRect().top;
	let lo = 0;
	let hi = headings.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const entry = headings[mid];
		if (!entry) break;
		if (entry.element.getBoundingClientRect().top - viewportTop <= 1) {
			found = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return found >= 0 ? (headings[found]?.id ?? fallback) : fallback;
}

export function activeHeadingId(scroller: HTMLElement, ids: readonly string[]): string | null {
	if (ids.length === 0) return null;
	return activeHeadingIdFromElements(
		scroller,
		resolveHeadingElements(scroller, ids),
		ids[0] ?? null,
	);
}
