import { RiLoader4Line as Loader2 } from "@remixicon/react";
import { parseToolResultContent } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { ToolArgList, toolArgEntries } from "../../ToolArgList";
import { Collapsible, countLines } from "../Collapsible";

export function McpHeader({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<div data-testid="mcp-card-header" className="flex min-w-0 items-center gap-4 tr-text-metadata">
			{icon}
			{children}
		</div>
	);
}

export function McpServerTool({ server, tool }: { server: string; tool: string }) {
	return (
		<>
			{server ? (
				<span className="min-w-0 truncate text-primary" title={server}>
					{server}
				</span>
			) : null}
			{server && tool ? <span className="shrink-0 text-text-subtle">/</span> : null}
			{tool ? (
				<span className="min-w-0 truncate text-text-default" title={tool}>
					{tool}
				</span>
			) : null}
		</>
	);
}

export function McpArgs({ id, args }: { id: string; args: Record<string, unknown> }) {
	const entries = toolArgEntries(args);
	if (entries.length === 0) return null;
	const lines = entries.reduce((total, entry) => total + Math.max(1, countLines(entry.value)), 0);
	return (
		<Collapsible id={id} lines={lines}>
			<ToolArgList data-testid="mcp-args" entries={entries} />
		</Collapsible>
	);
}

export function McpRunning({ label }: { label: string }) {
	return (
		<span
			data-testid="mcp-running"
			className="flex min-w-0 items-center gap-4 text-text-muted tr-text-metadata"
		>
			<Loader2 className="size-12 shrink-0 animate-spin motion-reduce:animate-none" />
			<span className="min-w-0 truncate">{label}</span>
		</span>
	);
}

export function McpOutput({
	id,
	text,
	result,
	failed,
}: {
	id: string;
	text: string;
	result: unknown;
	failed: boolean;
}) {
	const t = useT();
	if (!text) {
		return parseToolResultContent(result).images.length > 0 ? null : (
			<span className="text-text-muted tr-text-metadata italic">{t("mcp.card.noOutput")}</span>
		);
	}
	return (
		<Collapsible id={id} lines={countLines(text)}>
			<pre
				data-testid="mcp-output"
				data-failed={failed || undefined}
				className={cn(
					"overflow-auto whitespace-pre-wrap break-words rounded-sm bg-container-header-bg px-8 py-4 tr-code-text",
					failed ? "text-feedback-error" : "text-text-default",
				)}
			>
				{text}
			</pre>
		</Collapsible>
	);
}
