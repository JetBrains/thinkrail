import { RiLinksLine as LinkIcon } from "@remixicon/react";
import { numArg, resultText, strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import { WebResultBody } from "./WebResultBody";

function detailString(result: unknown, key: string): string {
	if (typeof result !== "object" || result === null || !("details" in result)) return "";
	const details = result.details;
	if (typeof details !== "object" || details === null) return "";
	const value = (details as Record<string, unknown>)[key];
	return typeof value === "string" ? value : "";
}

export function storedContentTarget(
	t: Translator,
	args: Record<string, unknown>,
	result: unknown,
): string {
	const query = strArg(args, "query") || detailString(result, "query");
	if (query) return query;
	const url = strArg(args, "url") || detailString(result, "url");
	if (url) return url;
	const queryIndex = numArg(args, "queryIndex");
	if (queryIndex !== null) return t("tools.webStored.queryIndex", { index: queryIndex });
	const urlIndex = numArg(args, "urlIndex");
	if (urlIndex !== null) return t("tools.webStored.urlIndex", { index: urlIndex });
	return "";
}

export function storedContentSummary({ args, result }: ToolRenderProps, t: Translator): string {
	return storedContentTarget(t, args, result) || strArg(args, "responseId");
}

export function WebStoredContentCard({ toolCallId, args, result, status }: ToolRenderProps) {
	const t = useT();
	const responseId = strArg(args, "responseId");
	const target = storedContentTarget(t, args, result);
	const output = resultText(result);
	return (
		<div data-testid="tool-get_search_content" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<LinkIcon className="size-12 shrink-0 text-text-muted" />
				<span className="min-w-0 truncate text-primary" title={target || responseId}>
					{target || responseId || t("tools.webStored.fallbackLabel")}
				</span>
				{target && responseId ? (
					<span className="shrink-0 text-text-muted" title={responseId}>
						{responseId}
					</span>
				) : null}
			</div>
			<WebResultBody
				id={`${toolCallId}:content`}
				output={output}
				status={status}
				runningLabel={t("tools.webStored.running")}
				emptyLabel={t("tools.webStored.empty")}
			/>
		</div>
	);
}
