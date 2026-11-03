import { expect, test } from "bun:test";
import { renderChatHighlight } from "./chatHighlighter";
import { chatLanguageId } from "./highlightCode";
import { SHIKI_FILE_LANGUAGES } from "./highlighter";

const SAMPLE = 'function main() { return "x" + 1; } // note';
const tokenColors = (html: string | null) => new Set(html?.match(/color:[^;"]+/g));

test("every Monaco catalog language has color in chat", () => {
	for (const { id } of SHIKI_FILE_LANGUAGES) {
		expect(tokenColors(renderChatHighlight(SAMPLE, id)).size, id).toBeGreaterThan(1);
	}
});

test("languages outside the Monaco catalog have color in chat", () => {
	for (const name of ["elixir", "dart", "zig", "ocaml", "terraform"]) {
		const id = chatLanguageId(name);
		expect(id).toBe(name);
		expect(tokenColors(renderChatHighlight(SAMPLE, name)).size, name).toBeGreaterThan(1);
	}
});

test("an unknown language renders no highlight", () => {
	expect(renderChatHighlight(SAMPLE, "not-a-language")).toBeNull();
});

test("colors are CSS variables so a theme swap needs no new highlight", () => {
	const colors = [...tokenColors(renderChatHighlight(SAMPLE, "typescript"))];
	expect(colors.length).toBeGreaterThan(0);
	for (const color of colors) expect(color).toContain("var(--code-");
});

test("every language reads the one color table", () => {
	for (const lang of ["python", "typescript"]) {
		expect(renderChatHighlight("value = other", lang)).toContain("var(--code-variable)");
	}
});

test("a code block is a keyboard focus stop", () => {
	expect(renderChatHighlight(SAMPLE, "typescript")).toStartWith('<pre tabindex="0" ');
});

test("CSS selectors and Markdown link text have color, Markdown headings do not", () => {
	const attribute = '<span style="color:var(--code-attribute-name)">';
	for (const selector of [".foo", "#bar"]) {
		expect(renderChatHighlight(`${selector} {}`, "css")).toContain(`${attribute}${selector}`);
	}
	expect(renderChatHighlight(".a {}", "scss")).toContain(`${attribute}.a`);
	const markdown = renderChatHighlight("# Title\n\n[link](http://x)", "markdown");
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
