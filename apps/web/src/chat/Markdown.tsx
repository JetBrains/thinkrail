import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "@/lib/highlighter";
import { MermaidView } from "./tools/visualize/MermaidView";

/**
 * The chat prose skin: `tr-prose-chat` (the generated markdown typography for a chat bubble — see
 * `typography.json` → `proseSystems.chat`) plus chat-bubble *spacing*, link colour, and table borders
 * (`border-muted` on every cell + `border-collapse`, so the outer frame and every row/column separator
 * are single lines; header/background are otherwise unchanged) and cell padding (`px-sm py-xs` on every
 * `th`/`td`, headers left-aligned). Typography is
 * never declared here; the document skin (`MarkdownPreview`) wears `tr-prose-doc`, which is the same
 * element set at a document scale.
 */
const CHAT_PROSE =
	"tr-prose-chat max-w-none break-words [&_a]:text-primary [&_a]:underline [&_li]:my-0.5 [&_ol]:my-sm [&_ol]:list-decimal [&_ol]:pl-lg [&_p]:my-sm [&_table]:border-collapse [&_td]:border [&_td]:border-border-muted [&_td]:px-sm [&_td]:py-xs [&_th]:border [&_th]:border-border-muted [&_th]:px-sm [&_th]:py-xs [&_th]:text-left [&_ul]:my-sm [&_ul]:list-disc [&_ul]:pl-lg";

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
				components={{ code: CodeBlock, a: Anchor, table: Table, ...components }}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}

/** A GFM table in its own horizontal scroller: the chat transcript scrolls only vertically (the
 * Virtuoso scroller is `overflow-x-hidden`), so like code blocks and tool cards, a table wider than
 * the bubble must scroll inside its own block — without the wrapper the overflow would simply be
 * clipped and unreachable. The `[&_table]` skin selectors still apply (descendant selectors). */
function Table({ children }: { children?: ReactNode }) {
	return (
		<div className="overflow-x-auto">
			<table>{children}</table>
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
	if (lang === "mermaid") return <MermaidBlock code={code} />;
	if (!lang) {
		if (!code.includes("\n")) {
			// Inline code sits directly behind a text run → the 2px inline-highlight tier (`xs`), not the
			// 4px default the fenced block below uses as a standalone container.
			return (
				<code className="rounded-[var(--radius-xs)] bg-container-elevated-bg px-1 py-0.5">
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

/**
 * Fenced ```mermaid → themed diagram via the visualize kit's `MermaidView` (theme-swap aware,
 * fullscreen pan-zoom, error → source). Shows the source block until the fence text has been stable
 * for a beat — so streaming chat deltas read as code instead of flickering parse errors — and always
 * on the very first pass, so static rendering (`RenderedDiff`'s `renderToStaticMarkup`, where effects
 * never run) degrades to code like every other fence. `whitespace-normal` resets the inherited
 * `white-space: pre` from react-markdown's native `<pre>` wrapper.
 */
function MermaidBlock({ code }: { code: string }) {
	const [settled, setSettled] = useState<string | null>(null);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(code), 200);
		return () => clearTimeout(timer);
	}, [code]);

	const source = <ShikiBlock code={code} lang="mermaid" />;
	if (settled !== code) return source;
	return (
		<div className="whitespace-normal">
			<MermaidView source={code} fallback={source} />
		</div>
	);
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
