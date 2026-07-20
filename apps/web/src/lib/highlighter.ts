import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { THINKRAIL_SHIKI_THEME, THINKRAIL_SHIKI_THEME_NAME } from "@/themes";

// Shared shiki highlighter for chat code blocks: the JS regex engine (no WASM), a curated language set,
// and one generic ThinkRail theme whose TextMate colors are live CSS variables. It stays behind the lazy
// highlighter import; a registry swap changes those variables, so existing markup follows without another
// highlight pass or a per-theme package import.

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
		themes: [THINKRAIL_SHIKI_THEME],
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
		return hl.codeToHtml(code, { lang: canonical, theme: THINKRAIL_SHIKI_THEME_NAME });
	} catch {
		return null;
	}
}
