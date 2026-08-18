import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "@/lib/highlighter";

/**
 * The chat prose skin: `tr-prose-chat` (the generated markdown typography for a chat bubble — see
 * `typography.json` → `proseSystems.chat`) plus chat-bubble *spacing*, link colour, and table borders
 * (`border-muted` on every cell + `border-collapse`, so the outer frame and every row/column separator
 * are single lines; header/background are otherwise unchanged) and cell padding (`px-8 py-4` on every
 * `th`/`td`, headers left-aligned). Typography is
 * never declared here; the document skin (`MarkdownPreview`) wears `tr-prose-doc`, which is the same
 * element set at a document scale.
 */
const CHAT_PROSE =
	"tr-prose-chat max-w-none break-words [&_a]:text-primary [&_a]:underline [&_li]:my-2 [&_ol]:my-8 [&_ol]:list-decimal [&_ol]:pl-16 [&_p]:my-8 [&_table]:border-collapse [&_td]:border [&_td]:border-border-muted [&_td]:px-8 [&_td]:py-4 [&_th]:border [&_th]:border-border-muted [&_th]:px-8 [&_th]:py-4 [&_th]:text-left [&_ul]:my-8 [&_ul]:list-disc [&_ul]:pl-16";

/**
 * Render GFM markdown with shiki-highlighted fenced code blocks. Presentational — no app/store deps.
 * The rendering (GFM + shiki) is fixed; the **prose skin** is the caller's via `className` (defaults to
 * the compact chat skin) — but its *typography* is not hand-written: every skin names exactly one
 * generated `tr-prose-*` system and then only carries spacing/measure/chrome. A caller can
 * also **extend** the rendering with extra `remarkPlugins` + `components` (e.g. the file view's GitHub
 * alert callouts) — they're merged after the built-in GFM plugin / `code`+`a` renderers.
 */
/** The `rehypePlugins` prop's exact shape — for callers building tuple-form plugin lists. */
export type MarkdownRehypePlugins = ComponentProps<typeof ReactMarkdown>["rehypePlugins"];

export function Markdown({
	text,
	className = CHAT_PROSE,
	remarkPlugins,
	rehypePlugins,
	components,
}: {
	text: string;
	className?: string;
	remarkPlugins?: ComponentProps<typeof ReactMarkdown>["remarkPlugins"];
	rehypePlugins?: ComponentProps<typeof ReactMarkdown>["rehypePlugins"];
	components?: ComponentProps<typeof ReactMarkdown>["components"];
}) {
	return (
		<div className={className}>
			<ReactMarkdown
				remarkPlugins={remarkPlugins ? [remarkGfm, ...remarkPlugins] : [remarkGfm]}
				rehypePlugins={rehypePlugins}
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
			// Inline code sits directly behind a text run → the 2px inline-highlight tier (`xs`), not the
			// 4px default the fenced block below uses as a standalone container.
			return (
				<code className="rounded-[var(--radius-xs)] bg-container-elevated-bg px-4 py-2">
					{children}
				</code>
			);
		}
		return (
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-elevated-bg p-8">
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
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-elevated-bg p-8 text-text-default">
				{code}
			</pre>
		);
	}
	return (
		<div
			className="overflow-auto rounded-[var(--radius-sm)] [&_pre]:!m-0 [&_pre]:!bg-container-elevated-bg [&_pre]:p-8"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is escaped, themed markup
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
