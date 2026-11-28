import { expect, test } from "bun:test";
import { parseDiffFromFile } from "@pierre/diffs";
import { renderToStaticMarkup } from "react-dom/server";
import { PlainCode } from "./PlainCode";
import { plainDiffRuns, plainFileRuns } from "./plainRuns";

test("a wrapped plain diff keeps every source-line marker with its text in bounded runs", () => {
	const runs = plainDiffRuns(
		parseDiffFromFile(
			{ name: "a.ts", contents: "unchanged\nold value\n\nlast\n" },
			{ name: "a.ts", contents: "unchanged\nnew value\n\nnew tail\nlast\n" },
		),
	);
	const html = renderToStaticMarkup(<PlainCode runs={runs} diff wrapLines />);
	expect(html).toContain("whitespace-pre-wrap");
	expect(html).toContain("[overflow-wrap:anywhere]");
	expect(html).toContain('data-kind="context" class=""> unchanged</div>');
	expect(html).toContain('data-kind="deletion" class="">-old value</div>');
	expect(html).toContain('data-kind="addition" class="">+new value</div>');
	expect(html).toContain('data-kind="context" class="">  </div>');
	expect(html).toContain('data-kind="addition" class="">+new tail</div>');
	expect(html).not.toContain("<span");
	expect(html.match(/<div /g)).toHaveLength(runs.length);
});

test("wrapping a 100k-line added file retains two runs instead of one element per line", () => {
	const contents = Array.from({ length: 100_000 }, (_, line) => `line ${line}`).join("\n");
	const runs = plainDiffRuns(parseDiffFromFile(null, { name: "large.ts", contents }));
	const html = renderToStaticMarkup(<PlainCode runs={runs} diff wrapLines />);
	expect(html).toContain("+line 0\n+line 1\n");
	expect(html).toContain("\n+line 99999</div>");
	expect(html.match(/<div /g)).toHaveLength(2);
	expect(html).not.toContain("<span");
	expect(runs[1]?.lines[0]).toBe("line 0");
	expect(runs[1]?.lines.at(-1)).toBe("line 99999");
});

test("unwrapped diffs keep separate nonselectable markers and ordinary files keep their text", () => {
	const runs = plainDiffRuns(
		parseDiffFromFile(null, { name: "a.ts", contents: "first\nsecond\n" }),
	);
	const diff = renderToStaticMarkup(<PlainCode runs={runs} diff />);
	expect(diff).toContain('<span class="select-none pr-8">+\n+</span><span>first\nsecond</span>');
	expect(diff).not.toContain("whitespace-pre-wrap");
	const file = renderToStaticMarkup(<PlainCode runs={plainFileRuns("first\nsecond\n")} />);
	expect(file).toContain("<span>first\nsecond</span>");
	expect(file).not.toContain("select-none");
	expect(file).not.toContain("whitespace-pre-wrap");
});
