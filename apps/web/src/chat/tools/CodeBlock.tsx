import { useHighlightedCode } from "@/lib/highlightCode";

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
	const html = useHighlightedCode(code, lang);

	if (html === null) {
		return (
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-header-bg p-8 tr-code-text text-text-default">
				{code}
			</pre>
		);
	}
	return (
		<div
			className="overflow-auto rounded-[var(--radius-sm)] tr-code-text [&_pre]:!m-0 [&_pre]:!bg-container-header-bg [&_pre]:p-8"
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
