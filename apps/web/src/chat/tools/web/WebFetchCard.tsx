import { Link as LinkIcon } from "lucide-react";
import type { ToolRenderProps } from "../../toolRegistry";
import { CodeBlock } from "../CodeBlock";
import { Collapsible, countLines } from "../Collapsible";
import { resultText, strArg } from "../toolHelpers";

/** Hostname without a leading "www.", or the raw string if it isn't a URL. */
function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

/** First URL from `fetch_content` args (`url`, or the first of `urls[]`). */
function firstUrl(args: Record<string, unknown>): string {
	const single = strArg(args, "url");
	if (single) return single;
	const many = args.urls;
	return Array.isArray(many) && typeof many[0] === "string" ? many[0] : "";
}

/** Body for the `fetch_content` tool: fetched URL + its extracted content as markdown. */
export function WebFetchCard({ args, result, status }: ToolRenderProps) {
	const url = firstUrl(args);
	const label = url ? hostOf(url) : "fetch";
	const output = resultText(result);

	return (
		<div data-testid="tool-fetch_content" className="flex flex-col gap-xs">
			<div className="flex items-center gap-xs text-xs">
				<LinkIcon className="size-3.5 shrink-0 text-muted" />
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
				<span className="text-muted text-xs">Fetching…</span>
			) : status === "error" ? (
				<pre className="overflow-auto px-sm py-xs text-red text-xs">{output}</pre>
			) : output ? (
				<Collapsible lines={countLines(output)}>
					<CodeBlock code={output} lang="markdown" />
				</Collapsible>
			) : (
				<span className="text-hint text-xs italic">(no content)</span>
			)}
		</div>
	);
}
