import { useEffect, useState } from "react";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { THINKRAIL_SHIKI_THEME, THINKRAIL_SHIKI_THEME_NAME } from "@/themes";

// One generic TextMate registration emits semantic CSS-variable colors, so a theme swap updates this
// markup without re-highlighting or importing every bundled syntax theme.

// One shared highlighter: only the `diff` grammar, on the JS regex engine (no WASM).
let highlighter: Promise<HighlighterCore> | null = null;
function getHighlighter(): Promise<HighlighterCore> {
	highlighter ??= createHighlighterCore({
		themes: [THINKRAIL_SHIKI_THEME],
		langs: [import("@shikijs/langs/diff")],
		engine: createJavaScriptRegexEngine(),
	});
	return highlighter;
}

/** Renders a unified diff. Falls back to plain mono text until (or unless) shiki highlights it. */
export default function DiffViewer({ diff }: { diff: string }) {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		getHighlighter()
			.then((hl) => hl.codeToHtml(diff, { lang: "diff", theme: THINKRAIL_SHIKI_THEME_NAME }))
			.then((h) => {
				if (!cancelled) setHtml(h);
			})
			.catch(() => {
				if (!cancelled) setHtml(null);
			});
		return () => {
			cancelled = true;
		};
	}, [diff]);

	if (html === null) {
		return (
			<pre className="overflow-auto whitespace-pre p-sm font-[var(--font-mono)] text-xs text-muted">
				{diff}
			</pre>
		);
	}
	return (
		<div
			className="overflow-auto p-sm text-xs [&_pre]:!whitespace-pre [&_pre]:!bg-transparent"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is escaped, themed markup, not user HTML
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
