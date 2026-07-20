import { expect, test } from "bun:test";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { THINKRAIL_SHIKI_THEME, THINKRAIL_SHIKI_THEME_NAME } from "./shiki";

test("Shiki emits semantic CSS-variable colors instead of a bundled-theme palette", async () => {
	const highlighter = await createHighlighterCore({
		themes: [THINKRAIL_SHIKI_THEME],
		langs: [import("@shikijs/langs/typescript")],
		engine: createJavaScriptRegexEngine(),
	});
	const html = highlighter.codeToHtml('const message = "hello"', {
		lang: "typescript",
		theme: THINKRAIL_SHIKI_THEME_NAME,
	});
	expect(html).toContain("var(--code-");
	expect(html).toContain("var(--code-string)");
	expect(html).not.toContain("--shiki-light");
	highlighter.dispose();
});
