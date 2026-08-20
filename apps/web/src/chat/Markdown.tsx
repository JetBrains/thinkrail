import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "@/lib/highlighter";
import { MermaidView } from "./tools/visualize/MermaidView";

const CHAT_PROSE =
	"tr-prose-chat max-w-none break-words [&_a]:text-primary [&_a]:underline [&_li]:my-0.5 [&_ol]:my-sm [&_ol]:list-decimal [&_ol]:pl-lg [&_p]:my-sm [&_table]:border-collapse [&_td]:border [&_td]:border-border-muted [&_td]:px-sm [&_td]:py-xs [&_th]:border [&_th]:border-border-muted [&_th]:px-sm [&_th]:py-xs [&_th]:text-left [&_ul]:my-sm [&_ul]:list-disc [&_ul]:pl-lg";

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

function Table({ children }: { children?: ReactNode }) {
	return (
		<div className="overflow-x-auto">
			<table>{children}</table>
		</div>
	);
}

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
