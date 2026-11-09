import { expect, test } from "bun:test";
import { type ChatHighlight, createChatStreams } from "./chatHighlighter";
import { CODE_LANGUAGES } from "./codeLanguages";
import { chatLanguageId } from "./highlightCode";
import { assembleHighlight, HIGHLIGHT_PRE_END, planHighlightPatch } from "./highlightHtml";

const SAMPLE = 'function main() { return "x" + 1; } // note';
const wholeRender = (code: string, lang: string) => {
	const result = createChatStreams().highlight("k", code, lang);
	return result && "html" in result ? result.html : null;
};
const tokenColors = (html: string | null) => new Set(html?.match(/color:[^;"]+/g));

test("every Monaco catalog language has color in chat", () => {
	for (const { id } of CODE_LANGUAGES) {
		expect(tokenColors(wholeRender(SAMPLE, id)).size, id).toBeGreaterThan(1);
	}
});

test("languages outside the Monaco catalog have color in chat", () => {
	for (const name of ["elixir", "dart", "zig", "ocaml", "terraform"]) {
		const id = chatLanguageId(name);
		expect(id).toBe(name);
		expect(tokenColors(wholeRender(SAMPLE, name)).size, name).toBeGreaterThan(1);
	}
});

test("an unknown language renders no highlight", () => {
	expect(wholeRender(SAMPLE, "not-a-language")).toBeNull();
});

test("colors are CSS variables so a theme swap needs no new highlight", () => {
	const colors = [...tokenColors(wholeRender(SAMPLE, "typescript"))];
	expect(colors.length).toBeGreaterThan(0);
	for (const color of colors) expect(color).toContain("var(--code-");
});

test("every language reads the one color table", () => {
	for (const lang of ["python", "typescript"]) {
		expect(wholeRender("value = other", lang)).toContain("var(--code-variable)");
	}
});

test("a code block is a keyboard focus stop", () => {
	expect(wholeRender(SAMPLE, "typescript")).toStartWith('<pre tabindex="0" ');
});

test("CSS selectors and Markdown link text have color, Markdown headings do not", () => {
	const attribute = '<span style="color:var(--code-attribute-name)">';
	for (const selector of [".foo", "#bar"]) {
		expect(wholeRender(`${selector} {}`, "css")).toContain(`${attribute}${selector}`);
	}
	expect(wholeRender(".a {}", "scss")).toContain(`${attribute}.a`);
	const markdown = wholeRender("# Title\n\n[link](http://x)", "markdown");
	expect(markdown).toContain('<span style="color:var(--code-string)">link</span>');
	expect(markdown).toContain('<span style="color:var(--code-foreground)"># Title');
});

for (const [tag, id] of [
	["ts", "typescript"],
	["Java", "java"],
	["c++", "cpp"],
	["c#", "csharp"],
	["xhtml", "html"],
] as const) {
	test(`the ${tag} fence resolves to ${id}`, () => {
		expect(chatLanguageId(tag)).toBe(id);
	});
}

for (const tag of ["mermaid", "text", "plaintext", "txt", "plain", " "]) {
	test(`the "${tag}" fence stays plain`, () => {
		expect(chatLanguageId(tag)).toBeNull();
	});
}

const TS_LINES = [
	"const a = 1;",
	"/* comment that",
	"   spans lines */",
	"function f(x: string) {",
	'  return "<&>" + x;',
	"}",
	"",
];

function shownHtml(shown: string[], result: ChatHighlight) {
	if (!result) throw new Error("no result");
	if ("html" in result) return result.html;
	const { open, from, lines, tail } = result.update;
	shown.length = from;
	shown.push(...lines);
	return assembleHighlight(open, shown, tail);
}

function charColors(html: string) {
	const colors: string[] = [];
	for (const [, style, text] of html.matchAll(/<span style="([^"]*)">([^<]*)<\/span>/g)) {
		const plain = (text ?? "")
			.replaceAll("&lt;", "<")
			.replaceAll("&gt;", ">")
			.replaceAll("&amp;", "&");
		for (const char of plain) if (char.trim()) colors.push(`${char}:${style}`);
	}
	return colors;
}

test("a stream sends only new lines and ends with the colors of a whole render", () => {
	const streams = createChatStreams();
	const shown: string[] = [];
	const whole = TS_LINES.join("\n");
	let code = "";
	let html = "";
	const sizes: number[] = [];
	for (const line of TS_LINES) {
		code += code ? `\n${line}` : line;
		const result = streams.highlight("k", code, "typescript");
		if (result && "update" in result) sizes.push(result.update.lines.length);
		html = shownHtml(shown, result);
	}
	expect(Math.max(...sizes)).toBeLessThanOrEqual(2);
	expect(charColors(html)).toEqual(charColors(wholeRender(whole, "typescript") ?? ""));
	streams.release("k");
	expect(streams.liveCount()).toBe(0);
});

test("a streamed ansi block keeps the colors of a whole render", () => {
	const streams = createChatStreams();
	const lines = ["\x1b[31mred\x1b[0m plain", "\x1b[1;32mbold green\x1b[0m", "done"];
	let code = "";
	let html = "";
	for (const line of lines) {
		code += code ? `\n${line}` : line;
		html = shownHtml([], streams.highlight("k", code, "ansi"));
	}
	expect(html).toBe(wholeRender(code, "ansi") ?? "");
	expect(html).not.toContain("\x1b");
	expect(tokenColors(html).size).toBeGreaterThan(1);
	streams.release("k");
});

test("a streamed code block is a keyboard focus stop", () => {
	const streams = createChatStreams();
	streams.highlight("k", "x", "typescript");
	const next = streams.highlight("k", "x\ny", "typescript");
	expect(next && "update" in next && next.update.open).toStartWith('<pre tabindex="0" ');
	streams.release("k");
});

test("a stream resets when the text stops being an append or the language changes", () => {
	const streams = createChatStreams();
	streams.highlight("k", "const a = 1;", "typescript");
	streams.highlight("k", "const a = 1;\nconst b = 2;\nconst c", "typescript");
	const next = streams.highlight("k", "const a = 1;\nconst b = 2;\nconst c = 3;\n", "typescript");
	expect(next && "update" in next && next.update.from).toBe(2);
	const edited = streams.highlight("k", "let z = 9;\nlet y", "typescript");
	expect(edited && "update" in edited && edited.update.from).toBe(0);
	const language = streams.highlight("k", "let z = 9;\nlet y = 1", "python");
	expect(language && "update" in language && language.update.from).toBe(0);
	streams.release("k");
});

test("live tokenizers stay under the cap, oldest first", () => {
	const streams = createChatStreams({ maxLive: 2 });
	for (const key of ["a", "b", "c"]) {
		streams.highlight(key, "x", "typescript");
		streams.highlight(key, "x\ny", "typescript");
	}
	expect(streams.liveCount()).toBe(2);
	const rebuilt = streams.highlight("a", "x\ny\nz", "typescript");
	expect(rebuilt && "update" in rebuilt && rebuilt.update.from).toBe(0);
	for (const key of ["a", "b", "c"]) streams.release(key);
	expect(streams.liveCount()).toBe(0);
});

test("an idle tokenizer is freed, and the next update rebuilds it", async () => {
	const streams = createChatStreams({ idleMs: 5 });
	streams.highlight("k", "x", "typescript");
	streams.highlight("k", "x\ny", "typescript");
	expect(streams.liveCount()).toBe(1);
	await Bun.sleep(30);
	expect(streams.liveCount()).toBe(0);
	const rebuilt = streams.highlight("k", "x\ny\nz", "typescript");
	expect(rebuilt && "update" in rebuilt && rebuilt.update.from).toBe(0);
	streams.release("k");
});

test("a released key renders whole again, and an unknown language renders nothing", () => {
	const streams = createChatStreams();
	streams.highlight("k", "x", "typescript");
	streams.release("k");
	const again = streams.highlight("k", "y", "typescript");
	expect(again && "html" in again).toBe(true);
	expect(streams.highlight("u", "x", "not-a-language")).toBeNull();
	streams.release("k");
});

test("the next update appends after the shown lines", () => {
	const first = assembleHighlight("<pre><code>", ["A"], "b");
	const planned = planHighlightPatch(null, first);
	expect(planned).toEqual({ kind: "replace", stable: "<pre><code>A\n" });
	const next = assembleHighlight("<pre><code>", ["A", "B"], "c");
	expect(planHighlightPatch(planned.stable, next)).toEqual({
		kind: "append",
		stable: "<pre><code>A\nB\n",
		added: "B\n<span data-highlight-tail>c</span>",
	});
});

test("the patch keeps plain text that follows the tail", () => {
	const shown = assembleHighlight("<pre><code>", ["A"], "b");
	const stale = `${shown.slice(0, -HIGHLIGHT_PRE_END.length)}more${HIGHLIGHT_PRE_END}`;
	const patch = planHighlightPatch("<pre><code>A\n", stale);
	expect(patch).toEqual({
		kind: "append",
		stable: "<pre><code>A\n",
		added: "<span data-highlight-tail>b</span>more",
	});
});

test("HTML that changes earlier lines or has no tail replaces the block", () => {
	const edited = assembleHighlight("<pre><code>", ["Z"], "b");
	expect(planHighlightPatch("<pre><code>A\n", edited).kind).toBe("replace");
	expect(planHighlightPatch("<pre><code>A\n", "<pre><code>A\n</code></pre>")).toEqual({
		kind: "replace",
		stable: null,
	});
});
