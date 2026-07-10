import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "@/lib/highlighter";

/** The default "prose skin": compact spacing tuned for a chat bubble. Callers (e.g. the file-tab
 * `MarkdownPreview`) pass their own `className` for a document skin. */
const CHAT_PROSE =
	"max-w-none break-words [&_a]:text-primary [&_a]:underline [&_h1]:font-semibold [&_h2]:font-semibold [&_li]:my-0.5 [&_ol]:my-sm [&_ol]:list-decimal [&_ol]:pl-lg [&_p]:my-sm [&_ul]:my-sm [&_ul]:list-disc [&_ul]:pl-lg";

/**
 * Render GFM markdown with shiki-highlighted fenced code blocks. Presentational — no app/store deps.
 * The rendering (GFM + shiki) is fixed; the **prose skin** is the caller's via `className` (defaults to
 * the compact chat skin). Code blocks size in `em`, so they scale with the skin's base font. A caller can
 * also **extend** the rendering with extra `remarkPlugins` + `components` (e.g. the file view's GitHub
 * alert callouts) — they're merged after the built-in GFM plugin / `code`+`a` renderers.
 */
export function Markdown({
	text,
	className = CHAT_PROSE,
	remarkPlugins,
	components,
}: {
	text: string;
	className?: string;
	remarkPlugins?: ComponentProps<typeof ReactMarkdown>["remarkPlugins"];
	components?: ComponentProps<typeof ReactMarkdown>["components"];
}) {
	return (
		<div className={className}>
			<ReactMarkdown
				remarkPlugins={remarkPlugins ? [remarkGfm, ...remarkPlugins] : [remarkGfm]}
				components={{ code: CodeBlock, a: Anchor, ...components }}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}

/** Open all links in a new tab (never navigate away from the app), with safe rel attrs. */
function Anchor({ href, children }: { href?: string | undefined; children?: ReactNode }) {
	return (
		<a href={href} target="_blank" rel="noopener noreferrer">
			{children}
		</a>
	);
}

function CodeBlock({
	className,
	children,
}: {
	className?: string | undefined;
	children?: ReactNode;
}) {
	const lang = /language-(\w+)/.exec(className ?? "")?.[1];
	const code = String(children ?? "").replace(/\n$/, "");
	if (!lang) {
		if (!code.includes("\n")) {
			return (
				<code className="rounded-[var(--radius-sm)] bg-elevated px-1 py-0.5 font-[var(--font-mono)] text-[0.85em]">
					{children}
				</code>
			);
		}
		return (
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-elevated p-sm font-[var(--font-mono)] text-[0.85em]">
				{code}
			</pre>
		);
	}
	return <ShikiBlock code={code} lang={lang} />;
}

function ShikiBlock({ code, lang }: { code: string; lang: string }) {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		highlightCode(code, lang)
			.then((h) => {
				if (!cancelled) setHtml(h);
			})
			.catch(() => {
				if (!cancelled) setHtml(null);
			});
		return () => {
			cancelled = true;
		};
	}, [code, lang]);

	if (html === null) {
		return (
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-elevated p-sm font-[var(--font-mono)] text-[0.85em] text-text">
				{code}
			</pre>
		);
	}
	return (
		<div
			className="overflow-auto rounded-[var(--radius-sm)] text-[0.85em] [&_pre]:!m-0 [&_pre]:!bg-elevated [&_pre]:p-sm"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is escaped, themed markup
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
