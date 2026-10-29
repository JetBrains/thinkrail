import { cn } from "@thinkrail/ui/utils";
import { marked, type Token, type Tokens } from "marked";
import type { ReactNode } from "react";
import { liveBlocks } from "../live/blocks";
import { isLiveBlock, LIVE_LINE } from "../live/names";

const REPOSITORY = "https://github.com/JetBrains/thinkrail/blob/main";

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[`*_]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function inline(tokens: readonly Token[] | undefined): ReactNode[] {
	return (tokens ?? []).map((token, index) => {
		const key = String(index);
		switch (token.type) {
			case "strong":
				return <strong key={key}>{inline((token as Tokens.Strong).tokens)}</strong>;
			case "em":
				return <em key={key}>{inline((token as Tokens.Em).tokens)}</em>;
			case "del":
				return <del key={key}>{inline((token as Tokens.Del).tokens)}</del>;
			case "codespan":
				return (
					<code key={key} className="rounded-xs bg-container-content-bg px-2">
						{(token as Tokens.Codespan).text}
					</code>
				);
			case "link": {
				const link = token as Tokens.Link;
				const repoFile = link.href.startsWith("/");
				const external = repoFile || /^https?:/.test(link.href);
				return (
					<a
						key={key}
						href={repoFile ? `${REPOSITORY}${link.href}` : link.href}
						{...(external ? { target: "_blank", rel: "noreferrer" } : {})}
						className="text-primary underline underline-offset-2"
					>
						{inline(link.tokens)}
					</a>
				);
			}
			case "br":
				return <br key={key} />;
			case "escape":
				return (token as Tokens.Escape).text;
			case "text": {
				const text = token as Tokens.Text;
				return text.tokens ? inline(text.tokens) : text.text;
			}
			default:
				return "raw" in token ? token.raw : null;
		}
	});
}

function headingId(prefix: string, text: string) {
	return `${prefix}-${slugify(text)}`;
}

function block(token: Token, key: string, prefix: string | null): ReactNode {
	switch (token.type) {
		case "heading": {
			const heading = token as Tokens.Heading;
			const id = prefix ? headingId(prefix, heading.text) : undefined;
			const className = cn("scroll-mt-16", heading.depth <= 2 && "pt-8");
			const children = inline(heading.tokens);
			return heading.depth <= 2 ? (
				<h2 key={key} id={id} className={className}>
					{children}
				</h2>
			) : heading.depth === 3 ? (
				<h3 key={key} id={id} className={className}>
					{children}
				</h3>
			) : (
				<h4 key={key} id={id} className={className}>
					{children}
				</h4>
			);
		}
		case "paragraph":
			return <p key={key}>{inline((token as Tokens.Paragraph).tokens)}</p>;
		case "list": {
			const list = token as Tokens.List;
			const Tag = list.ordered ? "ol" : "ul";
			return (
				<Tag
					key={key}
					className={cn("flex flex-col gap-6 pl-24", list.ordered ? "list-decimal" : "list-disc")}
				>
					{list.items.map((item, index) => (
						<li key={String(index)} className="pl-4">
							{item.tokens.map((child, i) => block(child, String(i), prefix))}
						</li>
					))}
				</Tag>
			);
		}
		case "code": {
			const fence = token as Tokens.Code;
			return (
				<pre
					key={key}
					className="overflow-x-auto rounded-md border border-border-default bg-container-content-bg p-16"
				>
					<code>{fence.text}</code>
				</pre>
			);
		}
		case "table": {
			const table = token as Tokens.Table;
			return (
				<div key={key} className="overflow-x-auto rounded-md border border-border-default">
					<table className="w-full border-collapse text-left">
						<thead className="bg-container-header-bg">
							<tr>
								{table.header.map((cell, index) => (
									<th key={String(index)} className="px-12 py-8">
										{inline(cell.tokens)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{table.rows.map((row, index) => (
								<tr key={String(index)} className="border-border-default border-t align-top">
									{row.map((cell, column) => (
										<td key={String(column)} className="px-12 py-8">
											{inline(cell.tokens)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		}
		case "blockquote":
			return (
				<blockquote
					key={key}
					className="flex flex-col gap-8 border-primary-muted border-l-2 py-4 pl-12 text-text-muted"
				>
					{(token as Tokens.Blockquote).tokens.map((child, index) =>
						block(child, String(index), prefix),
					)}
				</blockquote>
			);
		case "hr":
			return <hr key={key} className="border-border-default" />;
		case "text": {
			const text = token as Tokens.Text;
			return <span key={key}>{text.tokens ? inline(text.tokens) : text.text}</span>;
		}
		default:
			return null;
	}
}

type Segment = { kind: "markdown"; source: string } | { kind: "live"; name: string };

function segments(source: string): Segment[] {
	const out: Segment[] = [];
	let buffer: string[] = [];
	const flush = () => {
		if (buffer.join("").trim()) out.push({ kind: "markdown", source: buffer.join("\n") });
		buffer = [];
	};
	for (const line of source.split("\n")) {
		const match = LIVE_LINE.exec(line);
		if (match?.[1]) {
			flush();
			out.push({ kind: "live", name: match[1] });
		} else buffer.push(line);
	}
	flush();
	return out;
}

interface Heading {
	id: string;
	text: string;
	depth: number;
}

export function headings(source: string, prefix: string): Heading[] {
	return marked
		.lexer(source)
		.filter((token): token is Tokens.Heading => token.type === "heading" && token.depth <= 3)
		.map((heading) => ({
			id: headingId(prefix, heading.text),
			text: heading.text.replace(/[`*_]/g, ""),
			depth: heading.depth,
		}));
}

export function Markdown({
	source,
	className,
	anchors,
}: {
	source: string;
	className?: string;
	anchors?: string;
}) {
	return (
		<div className={cn("flex flex-col gap-16", className)}>
			{segments(source).map((segment, index) => {
				const key = String(index);
				if (segment.kind === "live") {
					const Live = isLiveBlock(segment.name) ? liveBlocks[segment.name] : null;
					return Live ? (
						<div key={key} data-live-block={segment.name}>
							<Live />
						</div>
					) : null;
				}
				return (
					<div
						key={key}
						className="tr-prose-doc flex flex-col gap-16 text-text-default [overflow-wrap:anywhere]"
					>
						{marked
							.lexer(segment.source)
							.map((token, i) => block(token, `${key}-${i}`, anchors ?? null))}
					</div>
				);
			})}
		</div>
	);
}

export function InlineMarkdown({ source }: { source: string }) {
	const first = marked.lexer(source)[0];
	return <>{first && "tokens" in first ? inline(first.tokens) : source}</>;
}
