import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { DARCULA_SHIKI, SHIKI_THEMES } from "./shikiTheme";

// Shared shiki highlighter for chat code blocks: the JS regex engine (no WASM), a curated language set,
// and the TRI theme (dark + light + darcula, from `shikiTheme.ts`) — all behind dynamic imports so nothing
// loads until the first code block renders. Matches the DiffViewer pattern; kept here so chat can highlight
// many languages. One render emits every palette as CSS vars; the `[data-theme]` rules in global.css flip
// between them, so a theme swap needs no re-highlighting.

const CANONICAL = new Set([
	"typescript",
	"tsx",
	"javascript",
	"jsx",
	"json",
	"bash",
	"python",
	"css",
	"html",
	"markdown",
	"diff",
	"yaml",
]);

// Common fence tags → the canonical grammar name loaded above.
const ALIAS: Record<string, string> = {
	ts: "typescript",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	md: "markdown",
	yml: "yaml",
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
function getHighlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= createHighlighterCore({
		themes: [
			import("@shikijs/themes/github-dark-default"),
			import("@shikijs/themes/github-light-default"),
			DARCULA_SHIKI,
		],
		langs: [
			import("@shikijs/langs/typescript"),
			import("@shikijs/langs/tsx"),
			import("@shikijs/langs/javascript"),
			import("@shikijs/langs/jsx"),
			import("@shikijs/langs/json"),
			import("@shikijs/langs/bash"),
			import("@shikijs/langs/python"),
			import("@shikijs/langs/css"),
			import("@shikijs/langs/html"),
			import("@shikijs/langs/markdown"),
			import("@shikijs/langs/diff"),
			import("@shikijs/langs/yaml"),
		],
		engine: createJavaScriptRegexEngine(),
	});
	return highlighterPromise;
}

/** Highlight `code` as `lang` → themed HTML, or `null` for an unknown language / failure (plain fallback). */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
	const key = lang.toLowerCase();
	const canonical = ALIAS[key] ?? key;
	if (!CANONICAL.has(canonical)) return null;
	try {
		const hl = await getHighlighter();
		return hl.codeToHtml(code, { lang: canonical, themes: SHIKI_THEMES, defaultColor: "dark" });
	} catch {
		return null;
	}
}
