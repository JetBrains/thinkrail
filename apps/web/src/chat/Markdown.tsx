import { MermaidView } from "@thinkrail/ext-visualize/web";
import { type ComponentProps, memo, type ReactNode, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "@/lib/highlighter";
import { createMarkdownSplitter } from "./markdownBlocks";

const CHAT_PROSE =
	"tr-prose-chat max-w-none break-words [&_a]:text-primary [&_a]:underline [&_li]:my-2 [&_ol]:my-8 [&_ol]:list-decimal [&_ol]:pl-16 [&_p]:my-8 [&_table]:border-collapse [&_td]:border [&_td]:border-border-muted [&_td]:px-8 [&_td]:py-4 [&_th]:border [&_th]:border-border-muted [&_th]:px-8 [&_th]:py-4 [&_th]:text-left [&_ul]:my-8 [&_ul]:list-disc [&_ul]:pl-16";

type ReactMarkdownProps = ComponentProps<typeof ReactMarkdown>;
export type MarkdownRehypePlugins = ReactMarkdownProps["rehypePlugins"];

interface MarkdownProps {
	text: string;
	className?: string;
	remarkPlugins?: ReactMarkdownProps["remarkPlugins"];
	rehypePlugins?: ReactMarkdownProps["rehypePlugins"];
	urlTransform?: ReactMarkdownProps["urlTransform"];
	components?: ReactMarkdownProps["components"];
}

interface MarkdownBlockProps extends Omit<MarkdownProps, "text" | "className"> {
	raw: string;
	separated: boolean;
}

export const Markdown = memo(function Markdown({
	text,
	className = CHAT_PROSE,
	remarkPlugins,
	components,
	...rest
}: MarkdownProps) {
	return (
		<div className={className}>
			<ReactMarkdown
				remarkPlugins={withDefaultPlugins(remarkPlugins)}
				components={withDefaultComponents(components)}
				{...rest}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});

export const BlockMarkdown = memo(function BlockMarkdown({
	text,
	className = CHAT_PROSE,
	remarkPlugins,
	components,
	...rest
}: MarkdownProps) {
	const [split] = useState(createMarkdownSplitter);
	const { blocks } = useMemo(() => split(text), [split, text]);
	const plugins = useMemo(() => withDefaultPlugins(remarkPlugins), [remarkPlugins]);
	const merged = useMemo(() => withDefaultComponents(components), [components]);
	return (
		<div className={className}>
			{blocks.map((block) => (
				<MarkdownBlock
					key={block.start}
					raw={block.raw}
					separated={block.start > 0}
					remarkPlugins={plugins}
					components={merged}
					{...rest}
				/>
			))}
		</div>
	);
});

const MarkdownBlock = memo(function MarkdownBlock({
	raw,
	separated,
	...props
}: MarkdownBlockProps) {
	return (
		<>
			{separated && "\n"}
			<ReactMarkdown {...props}>{raw}</ReactMarkdown>
		</>
	);
});

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
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-elevated-bg p-8 text-text-default">
				{code}
			</pre>
		);
	}
	return (
		<div
			className="overflow-auto rounded-[var(--radius-sm)] [&_pre]:!m-0 [&_pre]:!bg-container-elevated-bg [&_pre]:p-8"
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

const DEFAULT_REMARK_PLUGINS: ReactMarkdownProps["remarkPlugins"] = [remarkGfm];
const DEFAULT_COMPONENTS: ReactMarkdownProps["components"] = {
	code: CodeBlock,
	a: Anchor,
	table: Table,
};

function withDefaultPlugins(plugins: ReactMarkdownProps["remarkPlugins"]) {
	return plugins ? [remarkGfm, ...plugins] : DEFAULT_REMARK_PLUGINS;
}

function withDefaultComponents(components: ReactMarkdownProps["components"]) {
	return components ? { ...DEFAULT_COMPONENTS, ...components } : DEFAULT_COMPONENTS;
}
