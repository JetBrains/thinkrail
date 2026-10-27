import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { stripFrontmatter } from "./frontmatter";
import { DOCUMENT_ID_PREFIX } from "./markdownHtml";
import { collectMarkdownHeadings, type MarkdownHeading } from "./markdownLinks";

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

export function headingIdsInSlice(
	headings: readonly OutlineHeading[],
	startLine0: number,
	text: string,
): string[] {
	if (!text) return [];
	const start = startLine0 + 1;
	const end = startLine0 + text.split("\n").length;
	return flattenOutlineHeadings(headings).flatMap(({ heading }) =>
		heading.line >= start && heading.line <= end ? [heading.id] : [],
	);
}

export function headingElement(root: ParentNode, id: string): HTMLElement | null {
	for (const candidate of [`${DOCUMENT_ID_PREFIX}${id}`, id]) {
		const node = root.querySelector(`[id="${candidate}"]`);
		if (node) return node as HTMLElement;
	}
	return null;
}

export function scrollHeadingIntoView(scroller: HTMLElement, id: string): void {
	const heading = headingElement(scroller, id);
	if (!heading) return;
	const top =
		heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
	scroller.scrollTo({ top, behavior: "smooth" });
}

export function activeHeadingId(scroller: HTMLElement, ids: readonly string[]): string | null {
	if (ids.length === 0) return null;
	const viewportTop = scroller.getBoundingClientRect().top;
	let current = ids[0] ?? null;
	for (const id of ids) {
		const heading = headingElement(scroller, id);
		if (!heading) continue;
		if (heading.getBoundingClientRect().top - viewportTop <= 1) current = id;
	}
	return current;
}
