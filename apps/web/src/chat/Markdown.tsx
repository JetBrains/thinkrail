import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "@/lib/highlighter";

/**
 * The chat prose skin: `tr-prose-chat` (the generated markdown typography for a chat bubble — see
 * `typography.json` → `proseSystems.chat`) plus chat-bubble *spacing* and link colour. Typography is
 * never declared here; the document skin (`MarkdownPreview`) wears `tr-prose-doc`, which is the same
 * element set at a document scale.
 */
const CHAT_PROSE =
	"tr-prose-chat max-w-none break-words [&_a]:text-primary [&_a]:underline [&_li]:my-0.5 [&_ol]:my-sm [&_ol]:list-decimal [&_ol]:pl-lg [&_p]:my-sm [&_ul]:my-sm [&_ul]:list-disc [&_ul]:pl-lg";

/**
 * Render GFM markdown with shiki-highlighted fenced code blocks. Presentational — no app/store deps.
 * The rendering (GFM + shiki) is fixed; the **prose skin** is the caller's via `className` (defaults to
 * the compact chat skin) — but its *typography* is not hand-written: every skin names exactly one
 * generated `tr-prose-*` system and then only carries spacing/measure/chrome. A caller can
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
				<code className="rounded-[var(--radius-sm)] bg-container-elevated-bg px-1 py-0.5">
					{children}
				</code>
			);
		}
		return (
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-elevated-bg p-sm">
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
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-elevated-bg p-sm text-text-default">
				{code}
			</pre>
		);
	}
	return (
		<div
			className="overflow-auto rounded-[var(--radius-sm)] [&_pre]:!m-0 [&_pre]:!bg-container-elevated-bg [&_pre]:p-sm"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is escaped, themed markup
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
