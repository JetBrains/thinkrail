import { Search } from "lucide-react";
import type { ToolRenderProps } from "../../toolRegistry";
import { CodeBlock } from "../CodeBlock";
import { Collapsible, countLines } from "../Collapsible";
import { resultText, strArg } from "../toolHelpers";

/** First query string from `web_search` args (`query`, or the first of `queries[]`). */
function firstQuery(args: Record<string, unknown>): string {
	const single = strArg(args, "query");
	if (single) return single;
	const many = args.queries;
	return Array.isArray(many) && typeof many[0] === "string" ? many[0] : "";
}

/** Best-effort provider name from the tool result (pi-web-access reports it in `details`; shape not typed). */
function providerOf(result: unknown): string {
	const details = (result as { details?: unknown } | null)?.details as
		| { provider?: unknown; results?: Array<{ provider?: unknown }> }
		| undefined;
	const p = details?.provider ?? details?.results?.[0]?.provider;
	return typeof p === "string" ? p : "";
}

/** Body for the `web_search` tool: query + provider + the synthesized answer / sources. */
export function WebSearchCard({ args, result, status }: ToolRenderProps) {
	const query = firstQuery(args);
	const provider = providerOf(result);
	const output = resultText(result);

	return (
		<div data-testid="tool-web_search" className="flex flex-col gap-xs">
			<div className="flex items-center gap-xs text-xs">
				<Search className="size-3.5 shrink-0 text-muted" />
				<span className="truncate text-primary" title={query}>
					{query}
				</span>
				{provider ? <span className="shrink-0 text-hint">via {provider}</span> : null}
			</div>
			{status === "running" ? (
				<span className="text-muted text-xs">Searching…</span>
			) : status === "error" ? (
				<pre className="overflow-auto px-sm py-xs text-red text-xs">{output}</pre>
			) : output ? (
				<Collapsible lines={countLines(output)}>
					<CodeBlock code={output} lang="markdown" />
				</Collapsible>
			) : (
				<span className="text-hint text-xs italic">No results.</span>
			)}
		</div>
	);
}
