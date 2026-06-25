import { Check, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib";
import { highlightCode } from "@/lib/highlighter";
import type { ChatMessage } from "@/store";

/** Render one chat message by its role. The list (ChatView) owns layout + spacing. */
export function ChatMessageView({ message }: { message: ChatMessage }) {
	switch (message.role) {
		case "user":
			return <UserMessage text={message.text} />;
		case "assistant":
			return (
				<AssistantMessage
					text={message.text}
					thinking={message.thinking}
					streaming={message.streaming}
				/>
			);
		case "system":
			return <SystemMessage text={message.text} />;
		case "tool_call":
			return <ToolExecutionCard message={message} />;
		case "tool_result":
			return <ToolOutput message={message} />;
		default:
			return null;
	}
}

function UserMessage({ text }: { text: string }) {
	return (
		<div className="flex justify-end">
			<div className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--bubble-user-border)] bg-[var(--bubble-user-bg)] px-md py-sm text-sm text-text">
				{text}
			</div>
		</div>
	);
}

function AssistantMessage({
	text,
	thinking,
	streaming,
}: {
	text: string;
	thinking?: string | undefined;
	streaming: boolean;
}) {
	return (
		<div className="text-sm text-text">
			{thinking ? (
				<details className="mb-sm rounded-[var(--radius-sm)] border border-border2 bg-elevated px-sm py-xs text-muted text-xs">
					<summary className="cursor-pointer select-none">Thinking</summary>
					<div className="mt-xs whitespace-pre-wrap">{thinking}</div>
				</details>
			) : null}
			<div className="max-w-none break-words [&_a]:text-primary [&_a]:underline [&_h1]:font-semibold [&_h2]:font-semibold [&_li]:my-0.5 [&_ol]:my-sm [&_ol]:list-decimal [&_ol]:pl-lg [&_p]:my-sm [&_ul]:my-sm [&_ul]:list-disc [&_ul]:pl-lg">
				<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock }}>
					{text}
				</ReactMarkdown>
				{streaming ? (
					<span className="ml-0.5 inline-block animate-pulse text-primary">▍</span>
				) : null}
			</div>
		</div>
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
		// Inline code (no language, single line) vs a fenced block without a language.
		if (!code.includes("\n")) {
			return (
				<code className="rounded-[var(--radius-sm)] bg-elevated px-1 py-0.5 font-[var(--font-mono)] text-[0.85em]">
					{children}
				</code>
			);
		}
		return (
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-elevated p-sm font-[var(--font-mono)] text-xs">
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
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-elevated p-sm font-[var(--font-mono)] text-xs text-text">
				{code}
			</pre>
		);
	}
	return (
		<div
			className="overflow-auto rounded-[var(--radius-sm)] text-xs [&_pre]:!m-0 [&_pre]:!bg-elevated [&_pre]:p-sm"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is escaped, themed markup
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

function SystemMessage({ text }: { text: string }) {
	return <div className="text-center text-hint text-xs">{text}</div>;
}

function formatArgs(args: unknown): string {
	if (args == null) return "";
	if (typeof args === "string") return args;
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return String(args);
	}
}

function ToolExecutionCard({ message }: { message: ChatMessage }) {
	const args = formatArgs(message.args);
	return (
		<div className="rounded-[var(--radius-sm)] border border-border2 bg-elevated px-sm py-xs">
			<div className="flex items-center gap-xs text-muted text-xs">
				{message.streaming ? (
					<Loader2 className="size-3 animate-spin" />
				) : (
					<Check className="size-3 text-green" />
				)}
				<span className="font-medium text-text">{message.toolName ?? "tool"}</span>
			</div>
			{args ? (
				<pre className="mt-xs overflow-auto font-[var(--font-mono)] text-[10px] text-muted">
					{args}
				</pre>
			) : null}
		</div>
	);
}

function ToolOutput({ message }: { message: ChatMessage }) {
	if (!message.output) return null;
	return (
		<pre
			className={cn(
				"overflow-auto rounded-[var(--radius-sm)] bg-bg-dark p-sm font-[var(--font-mono)] text-[10px]",
				message.isError ? "text-red" : "text-muted",
			)}
		>
			{message.output}
		</pre>
	);
}
