import { expect, test } from "bun:test";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { SYNTAX_VARIABLES } from "./runtime";
import { THINKRAIL_SHIKI_THEME, THINKRAIL_SHIKI_THEME_NAME } from "./shiki";

test("the TextMate map references exactly the semantic syntax variables", () => {
	const referenced = new Set<string>();
	for (const entry of THINKRAIL_SHIKI_THEME.settings ?? []) {
		for (const color of [entry.settings?.foreground, entry.settings?.background]) {
			for (const match of (color ?? "").matchAll(/var\((--[a-z-]+)\)/g)) {
				if (match[1]) referenced.add(match[1]);
			}
		}
	}
	const expected = new Set<string>([...Object.values(SYNTAX_VARIABLES), "--surface-content"]);
	expect(referenced).toEqual(expected);
});

// Token-granularity assertions are deliberately absent: bun's linux-x64 RegExp engine mis-tokenizes
// complex grammars nondeterministically (correct under V8 and macOS bun), so this pins only the
// platform-stable contract — every color leaves as a CSS variable, none as a baked palette value.
test("highlighted output carries CSS variables only, never a baked palette color", async () => {
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
	expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
	expect(html).not.toContain("--shiki-");
	highlighter.dispose();
});
