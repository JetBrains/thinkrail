import { RiLinksLine as LinkIcon } from "@remixicon/react";
import type { ToolRenderProps } from "../../toolRegistry";
import { numArg, resultText, strArg } from "../toolHelpers";
import { WebResultBody } from "./WebResultBody";

function detailString(result: unknown, key: string): string {
	if (typeof result !== "object" || result === null || !("details" in result)) return "";
	const details = (result as { details: unknown }).details;
	if (typeof details !== "object" || details === null) return "";
	const value = (details as Record<string, unknown>)[key];
	return typeof value === "string" ? value : "";
}

export function storedContentTarget(args: Record<string, unknown>, result: unknown): string {
	const query = strArg(args, "query") || detailString(result, "query");
	if (query) return query;
	const url = strArg(args, "url") || detailString(result, "url");
	if (url) return url;
	const queryIndex = numArg(args, "queryIndex");
	if (queryIndex !== null) return `query ${queryIndex}`;
	const urlIndex = numArg(args, "urlIndex");
	if (urlIndex !== null) return `URL ${urlIndex}`;
	return "";
}

export function storedContentSummary({ args, result }: ToolRenderProps): string {
	return storedContentTarget(args, result) || strArg(args, "responseId");
}

export function WebStoredContentCard({ args, result, status }: ToolRenderProps) {
	const responseId = strArg(args, "responseId");
	const target = storedContentTarget(args, result);
	const output = resultText(result);
	return (
		<div data-testid="tool-get_search_content" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<LinkIcon className="size-12 shrink-0 text-text-muted" />
				<span className="min-w-0 truncate text-primary" title={target || responseId}>
					{target || responseId || "stored content"}
				</span>
				{target && responseId ? (
					<span className="shrink-0 text-text-muted" title={responseId}>
						{responseId}
					</span>
				) : null}
			</div>
			<WebResultBody
				output={output}
				status={status}
				runningLabel="Loading stored content…"
				emptyLabel="(no stored content)"
			/>
		</div>
	);
}
