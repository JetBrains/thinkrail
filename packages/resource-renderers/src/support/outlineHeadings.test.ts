import { afterEach, expect, test } from "bun:test";
import {
	lastElementAtTop,
	nestOutlineHeadings,
	type OutlineNode,
	revealInList,
	scrollToHeading,
} from "./outlineHeadings";

function shape(nodes: readonly OutlineNode[]): unknown[] {
	return nodes.map((node) =>
		node.children.length ? [node.text, shape(node.children)] : node.text,
	);
}

test("entries nest under the nearest shallower heading, and a skipped level still nests one step", () => {
	const headings = [
		{ depth: 2, text: "Intro" },
		{ depth: 1, text: "Alpha" },
		{ depth: 3, text: "Deep" },
		{ depth: 2, text: "Beta" },
		{ depth: 2, text: "Beta" },
		{ depth: 1, text: "Gamma" },
	];
	const tree = nestOutlineHeadings(headings);
	expect(shape(tree)).toEqual(["Intro", ["Alpha", ["Deep", "Beta", "Beta"]], "Gamma"]);
	expect(tree[1]?.children.map((node) => node.index)).toEqual([2, 3, 4]);
});

test("the current heading is found with a bounded number of rect reads in a long document", () => {
	let reads = 0;
	const elements = Array.from(
		{ length: 3000 },
		(_, i) =>
			({
				getBoundingClientRect: () => {
					reads += 1;
					return { top: 80 + i * 40 - 60_000 };
				},
			}) as unknown as HTMLElement,
	);
	expect(lastElementAtTop(80, elements)).toBe(1500);
	expect(reads).toBeLessThanOrEqual(12);
	expect(lastElementAtTop(-70_000, elements)).toBe(-1);
	expect(lastElementAtTop(Number.MAX_SAFE_INTEGER, elements)).toBe(2999);
});

const realWindow = globalThis.window;

afterEach(() => {
	globalThis.window = realWindow;
});

function preferReducedMotion(reduce: boolean) {
	globalThis.window = { matchMedia: () => ({ matches: reduce }) } as unknown as typeof window;
}

test("selecting a heading opens its closed details and scrolls only the preview scroller", () => {
	const attributes = new Set<string>();
	const scrolled: ScrollToOptions[] = [];
	const scroller = {
		scrollTop: 100,
		getBoundingClientRect: () => ({ top: 40 }),
		scrollTo: (options: ScrollToOptions) => scrolled.push(options),
	};
	const details = {
		tagName: "DETAILS",
		parentElement: scroller,
		hasAttribute: (name: string) => attributes.has(name),
		setAttribute: (name: string) => attributes.add(name),
	};
	const heading = {
		tagName: "H2",
		parentElement: details,
		getBoundingClientRect: () => ({ top: attributes.has("open") ? 340 : 0 }),
	} as unknown as HTMLElement;
	preferReducedMotion(false);
	scrollToHeading(scroller as unknown as HTMLElement, heading);
	expect(attributes.has("open")).toBe(true);
	expect(scrolled).toEqual([{ top: 400, behavior: "smooth" }]);
	preferReducedMotion(true);
	scrollToHeading(scroller as unknown as HTMLElement, heading);
	expect(scrolled[1]).toEqual({ top: 400, behavior: "auto" });
});

test("revealing the active entry moves only the outline list's own scrollTop", () => {
	const list = {
		scrollTop: 50,
		getBoundingClientRect: () => ({ top: 100, bottom: 300 }),
	} as unknown as HTMLElement;
	const entry = (top: number) =>
		({ getBoundingClientRect: () => ({ top, bottom: top + 20 }) }) as unknown as HTMLElement;
	revealInList(list, entry(320));
	expect(list.scrollTop).toBe(90);
	revealInList(list, entry(60));
	expect(list.scrollTop).toBe(50);
	revealInList(list, entry(150));
	expect(list.scrollTop).toBe(50);
});
