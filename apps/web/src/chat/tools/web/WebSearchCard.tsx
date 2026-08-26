import { Search } from "lucide-react";
import type { ToolRenderProps } from "../../toolRegistry";
import { CodeBlock } from "../CodeBlock";
import { Collapsible, countLines } from "../Collapsible";
import { resultText, strArg } from "../toolHelpers";

function firstQuery(args: Record<string, unknown>): string {
	const single = strArg(args, "query");
	if (single) return single;
	const many = args.queries;
	return Array.isArray(many) && typeof many[0] === "string" ? many[0] : "";
}

function providerOf(result: unknown): string {
	const details = (result as { details?: unknown } | null)?.details as
		| { provider?: unknown; results?: Array<{ provider?: unknown }> }
		| undefined;
	const p = details?.provider ?? details?.results?.[0]?.provider;
	return typeof p === "string" ? p : "";
}

export function WebSearchCard({ args, result, status }: ToolRenderProps) {
	const query = firstQuery(args);
	const provider = providerOf(result);
	const output = resultText(result);

	return (
		<div data-testid="tool-web_search" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<Search className="size-14 shrink-0 text-text-muted" />
				<span className="truncate text-primary" title={query}>
					{query}
				</span>
				{provider ? <span className="shrink-0 text-text-muted">via {provider}</span> : null}
			</div>
			{status === "running" ? (
				<span className="text-text-muted tr-text-metadata">Searching…</span>
			) : status === "error" ? (
				<pre className="overflow-auto px-8 py-4 text-feedback-error tr-code-text">{output}</pre>
			) : output ? (
				<Collapsible lines={countLines(output)}>
					<CodeBlock code={output} lang="markdown" />
				</Collapsible>
			) : (
				<span className="text-text-muted tr-text-metadata italic">No results.</span>
			)}
		</div>
	);
}
