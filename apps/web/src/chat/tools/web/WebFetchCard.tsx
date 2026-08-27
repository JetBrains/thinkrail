import { RiLinksLine as LinkIcon } from "@remixicon/react";
import type { ToolRenderProps } from "../../toolRegistry";
import { ToolFileLink } from "../ToolFileLink";
import { resultText, strArg } from "../toolHelpers";
import { WebResultBody } from "./WebResultBody";

function httpUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url : null;
	} catch {
		return null;
	}
}

function firstUrl(args: Record<string, unknown>): string {
	const single = strArg(args, "url");
	if (single) return single;
	const many = args.urls;
	return Array.isArray(many) && typeof many[0] === "string" ? many[0] : "";
}

export function webFetchSummary({ args }: ToolRenderProps): string {
	return firstUrl(args);
}

export function WebFetchCard({ args, result, status, workspaceRoot, onOpenFile }: ToolRenderProps) {
	const url = firstUrl(args);
	const external = httpUrl(url);
	const label = external ? external.hostname.replace(/^www\./, "") : "fetch";
	const output = resultText(result);

	return (
		<div data-testid="tool-fetch_content" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<LinkIcon className="size-12 shrink-0 text-text-muted" />
				{external ? (
					<a
						href={external.href}
						target="_blank"
						rel="noreferrer"
						className="truncate text-primary hover:underline"
						title={url}
					>
						{label}
					</a>
				) : url ? (
					<ToolFileLink
						path={url}
						workspaceRoot={workspaceRoot}
						onOpenFile={onOpenFile}
						disabled={status === "running"}
						className="text-primary"
					/>
				) : (
					<span className="text-primary">{label}</span>
				)}
			</div>
			<WebResultBody
				output={output}
				status={status}
				runningLabel="Fetching…"
				emptyLabel="(no content)"
			/>
		</div>
	);
}
