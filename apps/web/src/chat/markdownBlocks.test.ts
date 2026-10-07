import { describe, expect, test } from "bun:test";
import { longMarkdown } from "../../../../e2e/perf/longMarkdown";
import { seededRandom } from "../../../../e2e/perf/seededRandom";
import { createMarkdownSplitter, type MarkdownSplit, splitMarkdown } from "./markdownBlocks";
import { MARKDOWN_EDGE_FIXTURES } from "./markdownFixtures.test";

function normalize(text: string) {
	return text.replace(/\r\n?/g, "\n");
}

function expectWellFormed(split: MarkdownSplit, input: string) {
	const text = normalize(input);
	expect(split.text).toBe(text);
	expect(split.blocks.map((block) => block.raw).join("")).toBe(text);
	let offset = 0;
	for (const block of split.blocks) {
		expect(block.start).toBe(offset);
		expect(block.raw.length).toBeGreaterThan(0);
		offset += block.raw.length;
	}
	if (split.whole) expect(split.blocks.length).toBeLessThanOrEqual(1);
}

function expectMatchesFresh(split: MarkdownSplit, input: string, sawWhole: boolean) {
	expectWellFormed(split, input);
	const fresh = splitMarkdown(input);
	if (split.whole && !fresh.whole) expect(sawWhole).toBe(true);
	else expect(split).toEqual(fresh);
	return sawWhole || fresh.whole;
}

function streamCharByChar(input: string, compareEvery = 1) {
	const split = createMarkdownSplitter();
	let sawWhole = false;
	for (let end = 0; end <= input.length; end += 1) {
		const prefix = input.slice(0, end);
		const result = split(prefix);
		if (end % compareEvery === 0 || end === input.length) {
			sawWhole = expectMatchesFresh(result, prefix, sawWhole);
		}
	}
}

function streamRandomDeltas(input: string, seed: number) {
	const random = seededRandom(seed);
	const split = createMarkdownSplitter();
	let sawWhole = false;
	for (let end = 0; end < input.length; ) {
		end = Math.min(input.length, end + 1 + Math.floor(random() * 60));
		const prefix = input.slice(0, end);
		sawWhole = expectMatchesFresh(split(prefix), prefix, sawWhole);
	}
}

describe("splitMarkdown", () => {
	for (const [name, fixture] of Object.entries(MARKDOWN_EDGE_FIXTURES)) {
		test(`incremental split equals fresh split: ${name}`, () => {
			streamCharByChar(fixture);
			for (let seed = 1; seed <= 20; seed += 1) streamRandomDeltas(fixture, seed);
		});
	}

	test("incremental split equals fresh split on the long stream fixture", {
		timeout: 30_000,
	}, () => {
		streamCharByChar(longMarkdown(5_000), 7);
		const text = longMarkdown();
		streamRandomDeltas(text, 1);
		expect(splitMarkdown(text).blocks.length).toBeGreaterThan(40);
	});

	test("stepwise extension of a long text equals one fresh split", () => {
		const text = longMarkdown(30_000);
		const replay = splitMarkdown(text);
		expectWellFormed(replay, text);
		const stepwise = createMarkdownSplitter();
		for (let end = 1; end < text.length; end += 4_000) stepwise(text.slice(0, end));
		expect(stepwise(text)).toEqual(replay);
	});

	test("keeps stable blocks by identity while streaming", () => {
		const text = longMarkdown(6_000);
		const split = createMarkdownSplitter();
		let previous = split(text.slice(0, 3_000));
		for (let end = 3_001; end <= text.length; end += 7) {
			const next = split(text.slice(0, end));
			const changed = next.blocks.filter((block, index) => block !== previous.blocks[index]);
			expect(changed.length).toBeLessThanOrEqual(3);
			previous = next;
		}
	});

	test("restarts at a stable boundary so earlier blocks can still change", () => {
		const heading = splitMarkdown("para\n#x", splitMarkdown("para\n#"));
		expect(heading.blocks.map((block) => block.raw)).toEqual(["para\n#x"]);
		const list = splitMarkdown("1. a\n\n2. b", splitMarkdown("1. a\n\n2"));
		expect(list.blocks.map((block) => block.raw)).toEqual(["1. a\n\n2. b"]);
		const bullets = splitMarkdown("- a\n- b", splitMarkdown("- a\n-"));
		expect(bullets.blocks.map((block) => block.raw)).toEqual(["- a\n- b"]);
	});

	test("headings, rules and closed fences end a block without a blank line", () => {
		const text = "## Heading\nA paragraph right below the heading.\n".repeat(200);
		const split = createMarkdownSplitter();
		let previous = split(text.slice(0, 1_000));
		for (let end = 1_007; end <= text.length; end += 7) {
			const next = split(text.slice(0, end));
			expect(
				next.blocks.filter((block, index) => block !== previous.blocks[index]).length,
			).toBeLessThanOrEqual(3);
			previous = next;
		}
		expect(previous.blocks.length).toBeGreaterThan(190);
		const raws = splitMarkdown("```ts\na\n```\nb\n***\nc\n## d\ne").blocks.map(
			(block) => block.raw,
		);
		expect(raws).toEqual(["```ts\na\n```\n", "b\n***\n", "c\n## d\n", "e"]);
	});

	test("a fence that only marked closes keeps the rest in one block", () => {
		const split = splitMarkdown(MARKDOWN_EDGE_FIXTURES.invalidClosingFence ?? "");
		expect(split.blocks).toHaveLength(1);
	});

	test("link and footnote definitions render the message whole, also nested", () => {
		for (const name of [
			"linkDefinitionAtEnd",
			"footnoteAtEnd",
			"definitionInBlockquote",
			"footnoteInList",
			"footnoteInOrderedList",
			"escapedFootnoteLabel",
		]) {
			const split = splitMarkdown(MARKDOWN_EDGE_FIXTURES[name] ?? "");
			expect(split.whole).toBe(true);
			expect(split.blocks).toHaveLength(1);
		}
	});

	test("a definition stays whole for the rest of the stream", () => {
		const whole = splitMarkdown("[d]: https://example.com\n\nnext\n\nmore");
		expect(splitMarkdown(`${whole.text}\n\nand more`, whole).whole).toBe(true);
	});

	test("bracket syntax in inline code or a fence does not render whole", () => {
		for (const name of ["regexInlineCode", "definitionInsideFence"]) {
			const split = splitMarkdown(MARKDOWN_EDGE_FIXTURES[name] ?? "");
			expect(split.whole).toBe(false);
			expect(split.blocks.length).toBeGreaterThan(1);
		}
	});

	test("keeps an HTML block that spans blank lines in one block", () => {
		const text = "<div>\n\n<div>\n\na\n\n</div>\n\nb\n\n</div>\n\nafter\n\nmore";
		const raws = splitMarkdown(text).blocks.map((block) => block.raw);
		expect(raws[0]).toStartWith("<div>\n\n<div>\n\na\n\n</div>\n\nb\n\n</div>\n\n");
		expect(raws.at(-1)).toBe("more");
	});

	test("closed HTML blocks in a row still split", () => {
		const split = splitMarkdown(MARKDOWN_EDGE_FIXTURES.detailsChain ?? "");
		expect(split.blocks.length).toBeGreaterThan(3);
		expect(split.blocks.at(-1)?.raw).toBe("Para three.");
	});

	test("a definition that is still streaming its line does not stay whole", () => {
		const text = `${MARKDOWN_EDGE_FIXTURES.definitionInProse}${"\n\nParagraph.".repeat(20)}`;
		const split = createMarkdownSplitter();
		let last = split("");
		for (let end = 1; end <= text.length; end += 1) last = split(text.slice(0, end));
		expect(last.whole).toBe(false);
		expect(last).toEqual(splitMarkdown(text));
	});

	test("an empty footnote definition already renders whole", () => {
		expect(splitMarkdown("Claim[^1].\n\nMore.\n\n[^1]:").whole).toBe(true);
	});

	test("normalizes CRLF without falling back to whole", () => {
		const split = splitMarkdown(MARKDOWN_EDGE_FIXTURES.crlf ?? "");
		expect(split.whole).toBe(false);
		expect(split.blocks.length).toBeGreaterThan(2);
		expect(split.blocks.some((block) => block.raw.includes("\r"))).toBe(false);
	});

	test("a raw marked trims becomes its own block rather than whole", () => {
		const split = splitMarkdown("intro\n\n- a\n- ");
		expect(split.whole).toBe(false);
		expect(split.blocks.map((block) => block.raw)).toEqual(["intro\n\n", "- a\n- "]);
	});

	test("a rewrite that does not extend the previous text starts over", () => {
		const first = splitMarkdown("# One\n\nalpha\n\nbeta\n\ngamma");
		const rewrite = splitMarkdown("# Two\n\ndelta", first);
		expect(rewrite).toEqual(splitMarkdown("# Two\n\ndelta"));
	});

	test("handles empty and whitespace-only text", () => {
		expect(splitMarkdown("").blocks).toEqual([]);
		expectWellFormed(splitMarkdown("  \n\n\t\n"), "  \n\n\t\n");
	});
});
