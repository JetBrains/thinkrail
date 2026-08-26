import { Link as LinkIcon } from "lucide-react";
import type { ToolRenderProps } from "../../toolRegistry";
import { CodeBlock } from "../CodeBlock";
import { Collapsible, countLines } from "../Collapsible";
import { resultText, strArg } from "../toolHelpers";

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

function firstUrl(args: Record<string, unknown>): string {
	const single = strArg(args, "url");
	if (single) return single;
	const many = args.urls;
	return Array.isArray(many) && typeof many[0] === "string" ? many[0] : "";
}

export function WebFetchCard({ args, result, status }: ToolRenderProps) {
	const url = firstUrl(args);
	const label = url ? hostOf(url) : "fetch";
	const output = resultText(result);

	return (
		<div data-testid="tool-fetch_content" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<LinkIcon className="size-14 shrink-0 text-text-muted" />
				{url ? (
					<a
						href={url}
						target="_blank"
						rel="noreferrer"
						className="truncate text-primary hover:underline"
						title={url}
					>
						{label}
					</a>
				) : (
					<span className="text-primary">{label}</span>
				)}
			</div>
			{status === "running" ? (
				<span className="text-text-muted tr-text-metadata">Fetching…</span>
			) : status === "error" ? (
				<pre className="overflow-auto px-8 py-4 text-feedback-error tr-code-text">{output}</pre>
			) : output ? (
				<Collapsible lines={countLines(output)}>
					<CodeBlock code={output} lang="markdown" />
				</Collapsible>
			) : (
				<span className="text-text-muted tr-text-metadata italic">(no content)</span>
			)}
		</div>
	);
}
