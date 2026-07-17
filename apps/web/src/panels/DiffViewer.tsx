import { useEffect, useState } from "react";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// Dual theme (dark + light) so a theme swap needs no re-highlight: one render emits both palettes as CSS
// vars and `[data-theme="light"] .shiki` (global.css) flips to the light one. Dark + Darcula use the default.
const THEMES = { dark: "github-dark-default", light: "github-light-default" } as const;

// One shared highlighter: only the `diff` grammar, on the JS regex engine (no WASM).
let highlighter: Promise<HighlighterCore> | null = null;
function getHighlighter(): Promise<HighlighterCore> {
	highlighter ??= createHighlighterCore({
		themes: [
			import("@shikijs/themes/github-dark-default"),
			import("@shikijs/themes/github-light-default"),
		],
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
			.then((hl) => hl.codeToHtml(diff, { lang: "diff", themes: THEMES, defaultColor: "dark" }))
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
