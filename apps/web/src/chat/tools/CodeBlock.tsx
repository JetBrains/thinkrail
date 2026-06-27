import { useEffect, useState } from "react";
import { highlightCode } from "@/lib/highlighter";

/**
 * Presentational code block. When `lang` is a known shiki language, renders themed HTML; otherwise (or
 * until shiki resolves) renders plain monospace text. No store/transport deps.
 */
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		if (!lang) {
			setHtml(null);
			return;
		}
		let cancelled = false;
		highlightCode(code, lang)
			.then((h) => !cancelled && setHtml(h))
			.catch(() => !cancelled && setHtml(null));
		return () => {
			cancelled = true;
		};
	}, [code, lang]);

	if (html === null) {
		return (
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-bg-dark p-sm font-[var(--font-mono)] text-text text-xs">
				{code}
			</pre>
		);
	}
	return (
		<div
			className="overflow-auto rounded-[var(--radius-sm)] text-xs [&_pre]:!m-0 [&_pre]:!bg-bg-dark [&_pre]:p-sm"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is escaped, themed markup
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
