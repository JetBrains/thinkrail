import { RiSearchLine as Search } from "@remixicon/react";
import type { ToolRenderProps } from "../../toolRegistry";
import { resultText, strArg } from "../toolHelpers";
import { WebResultBody } from "./WebResultBody";

function firstQuery(args: Record<string, unknown>): string {
	const single = strArg(args, "query");
	if (single) return single;
	const many = args.queries;
	return Array.isArray(many) && typeof many[0] === "string" ? many[0] : "";
}

export function webSearchSummary({ args }: ToolRenderProps): string {
	return firstQuery(args);
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
				<Search className="size-12 shrink-0 text-text-muted" />
				<span className="truncate text-primary" title={query}>
					{query}
				</span>
				{provider ? <span className="shrink-0 text-text-muted">via {provider}</span> : null}
			</div>
			<WebResultBody
				output={output}
				status={status}
				runningLabel="Searching…"
				emptyLabel="No results."
			/>
		</div>
	);
}
