import { cn } from "@thinkrail/ui/utils";
import { marked, type Token, type Tokens } from "marked";
import type { ReactNode } from "react";

function inline(tokens: readonly Token[] | undefined): ReactNode[] {
	return (tokens ?? []).map((token, index) => {
		const key = String(index);
		switch (token.type) {
			case "strong":
				return <strong key={key}>{inline((token as Tokens.Strong).tokens)}</strong>;
			case "em":
				return <em key={key}>{inline((token as Tokens.Em).tokens)}</em>;
			case "codespan":
				return (
					<code
						key={key}
						className="rounded-xs bg-container-content-bg px-2 tr-code-text text-text-default"
					>
						{(token as Tokens.Codespan).text}
					</code>
				);
			case "link":
				return (
					<a key={key} href={(token as Tokens.Link).href} className="text-primary underline">
						{inline((token as Tokens.Link).tokens)}
					</a>
				);
			case "text": {
				const text = token as Tokens.Text;
				return text.tokens ? inline(text.tokens) : text.text;
			}
			default:
				return "raw" in token ? token.raw : null;
		}
	});
}

function block(token: Token, key: string): ReactNode {
	switch (token.type) {
		case "paragraph":
			return <p key={key}>{inline((token as Tokens.Paragraph).tokens)}</p>;
		case "list": {
			const list = token as Tokens.List;
			const Tag = list.ordered ? "ol" : "ul";
			return (
				<Tag key={key}>
					{list.items.map((item, index) => (
						<li key={String(index)}>{item.tokens.map((child, i) => block(child, String(i)))}</li>
					))}
				</Tag>
			);
		}
		case "code":
			return (
				<pre key={key}>
					<code>{(token as Tokens.Code).text}</code>
				</pre>
			);
		case "text": {
			const text = token as Tokens.Text;
			return <span key={key}>{text.tokens ? inline(text.tokens) : text.text}</span>;
		}
		default:
			return null;
	}
}

export function Markdown({ source, className }: { source: string; className?: string }) {
	return (
		<div className={cn("tr-prose-doc text-text-default", className)}>
			{marked.lexer(source).map((token, index) => block(token, String(index)))}
		</div>
	);
}

export function InlineMarkdown({ source }: { source: string }) {
	const tokens = marked.lexer(source)[0];
	return <>{tokens && "tokens" in tokens ? inline(tokens.tokens) : source}</>;
}
