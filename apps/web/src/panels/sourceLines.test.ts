import { expect, test } from "bun:test";
import { frontmatterOffset, indivisibleSpans, snapSplitLine } from "./sourceLines";

// The preview splices in-flow comment cards by cutting the source at the anchor line and parsing each
// half independently, so a cut that halves a multi-line construct changes what the document IS. These
// pin the spans a cut has to step over (see `indivisibleSpans`).

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
	// The failure this exists for: cutting at 6 left `” ```ts ” ` unclosed, so the first half rendered its
	// own tail as code AND the leftover closing fence opened a second block over the rest of the file.
	expect(snapSplitLine(spans, 6)).toBe(9);
	expect(snapSplitLine(spans, 8)).toBe(9);
	// The fence's own first/last lines are clean cuts already (before it opens / after it closed).
	expect(snapSplitLine(spans, 4)).toBe(4);
	expect(snapSplitLine(spans, 9)).toBe(9);
	// Prose, headings and list items divide cleanly — a card between two items is the point.
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
	// ```` ```a``` ```` is inline code with a fence-length run, not an opener — treating it as one would
	// swallow the rest of the file into a phantom span.
	expect(indivisibleSpans(["text", "```a``` and more", "text"].join("\n"))).toEqual([]);
});

test("frontmatterOffset reports the lines stripFrontmatter removed", () => {
	const raw = ["---", "title: x", "---", "# Doc", "body"].join("\n");
	expect(frontmatterOffset(raw, ["# Doc", "body"].join("\n"))).toBe(3);
	expect(frontmatterOffset("# Doc\nbody", "# Doc\nbody")).toBe(0);
});
