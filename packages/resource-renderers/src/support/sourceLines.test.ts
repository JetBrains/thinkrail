import { expect, test } from "bun:test";
import {
	closedDetailsAround,
	frontmatterOffset,
	indivisibleSpans,
	openDetailsAround,
	revealSourceLine,
	snapSplitLine,
	sourceBlockAt,
	stampedHeadings,
} from "./sourceLines";

const DOC = [
	"# Title", // 1
	"", // 2
	"A paragraph.", // 3
	"", // 4
	"```ts", // 5
	"const a = 1;", // 6
	"", // 7
	"const b = 2;", // 8
	"```", // 9
	"", // 10
	"## After the fence", // 11
	"", // 12
	"| col | col |", // 13
	"| --- | :-: |", // 14
	"| a   | b   |", // 15
	"| c   | d   |", // 16
	"", // 17
	"- item one", // 18
	"- item two", // 19
].join("\n");

test("indivisibleSpans covers the fence and the table, and nothing else", () => {
	expect(indivisibleSpans(DOC)).toEqual([
		{ start: 5, end: 9 },
		{ start: 13, end: 16 },
	]);
});

test("a cut inside a fence lands after its closing line; a cut in prose stays put", () => {
	const spans = indivisibleSpans(DOC);
	expect(snapSplitLine(spans, 6)).toBe(9);
	expect(snapSplitLine(spans, 8)).toBe(9);
	expect(snapSplitLine(spans, 4)).toBe(4);
	expect(snapSplitLine(spans, 9)).toBe(9);
	expect(snapSplitLine(spans, 3)).toBe(3);
	expect(snapSplitLine(spans, 11)).toBe(11);
	expect(snapSplitLine(spans, 18)).toBe(18);
});

test("a table body cut keeps its header: the whole table moves the card below it", () => {
	const spans = indivisibleSpans(DOC);
	expect(snapSplitLine(spans, 13)).toBe(16);
	expect(snapSplitLine(spans, 15)).toBe(16);
	expect(snapSplitLine(spans, 16)).toBe(16);
});

test("an UNCLOSED fence owns the rest of the document (CommonMark), so nothing inside it is cut", () => {
	const doc = ["intro", "```", "code", "more code"].join("\n");
	expect(indivisibleSpans(doc)).toEqual([{ start: 2, end: 4 }]);
	expect(snapSplitLine(indivisibleSpans(doc), 3)).toBe(4);
});

test("tilde fences, indented fences and longer markers all close on their own marker", () => {
	const doc = ["~~~", "```not a close```", "~~~", "", "  ````", "~~~", "  ````"].join("\n");
	expect(indivisibleSpans(doc)).toEqual([
		{ start: 1, end: 3 },
		{ start: 5, end: 7 },
	]);
});

test("a line of inline code is not a fence (a backtick in a backtick fence's info string)", () => {
	expect(indivisibleSpans(["text", "```a``` and more", "text"].join("\n"))).toEqual([]);
});

test("frontmatterOffset reports the lines stripFrontmatter removed", () => {
	const raw = ["---", "title: x", "---", "# Doc", "body"].join("\n");
	expect(frontmatterOffset(raw, ["# Doc", "body"].join("\n"))).toBe(3);
	expect(frontmatterOffset("# Doc\nbody", "# Doc\nbody")).toBe(0);
});

test("sourceBlockAt picks the outermost block that starts closest at or before the line", () => {
	const block = (id: string, start: number) => ({ id, dataset: { mdLineStart: String(start) } });
	const blocks = [
		block("h1", 6),
		block("p", 8),
		block("h2", 12),
		block("code-in-h2", 12),
		block("p2", 14),
	];
	const container = {
		querySelectorAll: () => blocks,
	} as unknown as ParentNode;
	const at = (line: number) =>
		(sourceBlockAt(container, line) as unknown as { id: string } | null)?.id;
	expect(at(12)).toBe("h2");
	expect(at(13)).toBe("h2");
	expect(at(9)).toBe("p");
	expect(at(40)).toBe("p2");
	expect(at(3)).toBeUndefined();
});

function revealContainer(starts: number[], scrolled: string[]) {
	const blocks = starts.map((start) => ({
		id: `block-${start}`,
		dataset: { mdLineStart: String(start) },
		scrollIntoView: () => scrolled.push(`block-${start}`),
	}));
	const rendered = { blocks: [] as typeof blocks };
	const container = {
		querySelectorAll: () => rendered.blocks,
		querySelector: () => rendered.blocks[0] ?? null,
	} as unknown as HTMLElement;
	return { container, render: () => (rendered.blocks = blocks) };
}

test("revealSourceLine scrolls the line's block, or the first one for a line before every block, and reports it", () => {
	const scrolled: string[] = [];
	const { container, render } = revealContainer([7, 12], scrolled);
	render();
	let reported = 0;
	revealSourceLine(container, 13, () => {
		reported += 1;
	})();
	revealSourceLine(container, 6, () => {
		reported += 1;
	})();
	expect(scrolled).toEqual(["block-12", "block-7"]);
	expect(reported).toBe(2);
});

test("revealSourceLine waits for a document still rendering and reports once it scrolled", () => {
	const scrolled: string[] = [];
	const { container, render } = revealContainer([3], scrolled);
	const observers: { notify: () => void; disconnected: boolean }[] = [];
	const RealObserver = globalThis.MutationObserver;
	globalThis.MutationObserver = class {
		disconnected = false;
		readonly callback: () => void;
		constructor(callback: () => void) {
			this.callback = callback;
			observers.push(this as unknown as { notify: () => void; disconnected: boolean });
		}
		notify() {
			this.callback();
		}
		observe() {}
		disconnect() {
			this.disconnected = true;
		}
	} as unknown as typeof MutationObserver;
	try {
		let reported = 0;
		revealSourceLine(container, 5, () => {
			reported += 1;
		});
		expect(reported).toBe(0);
		observers[0]?.notify();
		expect(reported).toBe(0);
		render();
		observers[0]?.notify();
		expect(scrolled).toEqual(["block-3"]);
		expect(reported).toBe(1);
		expect(observers[0]?.disconnected).toBe(true);
	} finally {
		globalThis.MutationObserver = RealObserver;
	}
});

interface FakeNode {
	nodeType: number;
	tagName: string;
	parentElement: FakeNode | null;
	dataset: { mdLineStart?: string };
	textContent: string;
	childNodes: unknown[];
	attributes: Set<string>;
	getAttribute(name: string): string | null;
	hasAttribute(name: string): boolean;
	setAttribute(name: string, value: string): void;
}

function fakeNode(tagName: string, parentElement: FakeNode | null, extra: Partial<FakeNode> = {}) {
	const attributes = new Set<string>();
	const node: FakeNode = {
		nodeType: 1,
		tagName,
		parentElement,
		dataset: {},
		textContent: "",
		childNodes: [],
		attributes,
		getAttribute: () => null,
		hasAttribute: (name) => attributes.has(name),
		setAttribute: (name) => {
			attributes.add(name);
		},
		...extra,
	};
	return node;
}

function textNode(value: string) {
	return { nodeType: 3, nodeValue: value };
}

function imageNode(alt: string | null) {
	return {
		...fakeNode("IMG", null),
		getAttribute: (name: string) => (name === "alt" ? alt : null),
	};
}

function headingTree() {
	const root = fakeNode("DIV", null);
	const details = fakeNode("DETAILS", root);
	const summary = fakeNode("SUMMARY", details);
	const heading = (tag: string, parent: FakeNode, line: string, text: string) =>
		fakeNode(tag, parent, {
			dataset: { mdLineStart: line },
			textContent: text,
			childNodes: [textNode(text)],
		});
	const nodes = [
		heading("H1", root, "4", "  Title\n  one "),
		heading("H2", root, "", "Unstamped"),
		heading("H2", root, "7", "   "),
		heading("H3", summary, "9", "In summary"),
		heading("H2", details, "11", "中文"),
		heading("H2", root, "14", "中文"),
	];
	const container = Object.assign(root, {
		querySelectorAll: () => nodes,
	}) as unknown as HTMLElement;
	return { container, details, nodes };
}

test("stampedHeadings keeps stamped, named headings with their source line, depth and closed-details state", () => {
	const { container } = headingTree();
	expect(
		stampedHeadings(container).map(({ line, depth, text, hidden }) => ({
			line,
			depth,
			text,
			hidden,
		})),
	).toEqual([
		{ line: 4, depth: 1, text: "Title one", hidden: false },
		{ line: 9, depth: 3, text: "In summary", hidden: false },
		{ line: 11, depth: 2, text: "中文", hidden: true },
		{ line: 14, depth: 2, text: "中文", hidden: false },
	]);
});

test("openDetailsAround opens every closed details that hides an element, and only those", () => {
	const { container, details, nodes } = headingTree();
	const hidden = nodes[4] as unknown as Element;
	const summary = nodes[3] as unknown as Element;
	expect(closedDetailsAround(summary, container)).toEqual([]);
	expect(closedDetailsAround(hidden, container)).toEqual([details as unknown as HTMLElement]);
	openDetailsAround(hidden, container);
	expect(details.hasAttribute("open")).toBe(true);
	expect(closedDetailsAround(hidden, container)).toEqual([]);
});

test("revealSourceLine opens a closed details before scrolling its block", () => {
	const details = fakeNode("DETAILS", null);
	const scrolled: string[] = [];
	const block = {
		...fakeNode("H2", details),
		dataset: { mdLineStart: "5" },
		scrollIntoView: () => scrolled.push(details.hasAttribute("open") ? "open" : "closed"),
	};
	const container = {
		querySelectorAll: () => [block],
		querySelector: () => block,
	} as unknown as HTMLElement;
	details.parentElement = container as unknown as FakeNode;
	revealSourceLine(container, 5, () => {})();
	expect(scrolled).toEqual(["open"]);
});

test("stampedHeadings reads an image in a heading as its alt text", () => {
	const root = fakeNode("DIV", null);
	const link = { ...fakeNode("A", null), childNodes: [imageNode("Diagram")] };
	const nodes = [
		fakeNode("H1", root, { dataset: { mdLineStart: "1" }, childNodes: [imageNode("Overview")] }),
		fakeNode("H2", root, {
			dataset: { mdLineStart: "3" },
			childNodes: [textNode("See "), link, textNode(" below")],
		}),
		fakeNode("H2", root, { dataset: { mdLineStart: "5" }, childNodes: [imageNode(null)] }),
		fakeNode("H2", root, { dataset: { mdLineStart: "7" }, childNodes: [textNode("Install")] }),
	];
	const container = Object.assign(root, {
		querySelectorAll: () => nodes,
	}) as unknown as HTMLElement;
	expect(stampedHeadings(container).map(({ line, text }) => ({ line, text }))).toEqual([
		{ line: 1, text: "Overview" },
		{ line: 3, text: "See Diagram below" },
		{ line: 7, text: "Install" },
	]);
});
