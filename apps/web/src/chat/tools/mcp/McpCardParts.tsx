import { RiLoader4Line as Loader2 } from "@remixicon/react";
import { parseToolResultContent } from "@thinkrail/extension-api/web";
import { cn } from "@thinkrail/ui/utils";
import { Fragment, type ReactNode } from "react";
import { Collapsible, countLines } from "../Collapsible";
import { mcpArgEntries } from "./mcpResult";

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
	const entries = mcpArgEntries(args);
	if (entries.length === 0) return null;
	const lines = entries.reduce((total, entry) => total + Math.max(1, countLines(entry.value)), 0);
	return (
		<Collapsible id={id} lines={lines}>
			<dl
				data-testid="mcp-args"
				className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-2 tr-code-text"
			>
				{entries.map(({ key, value }) => (
					<Fragment key={key}>
						<dt className="text-text-muted">{key}</dt>
						<dd className="min-w-0 whitespace-pre-wrap break-words text-text-default">{value}</dd>
					</Fragment>
				))}
			</dl>
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
	if (!text) {
		return parseToolResultContent(result).images.length > 0 ? null : (
			<span className="text-text-muted tr-text-metadata italic">(no output)</span>
		);
	}
	return (
		<Collapsible id={id} lines={countLines(text)}>
			<pre
				data-testid="mcp-output"
				data-failed={failed || undefined}
				className={cn(
					"overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-container-header-bg px-8 py-4 tr-code-text",
					failed ? "text-feedback-error" : "text-text-default",
				)}
			>
				{text}
			</pre>
		</Collapsible>
	);
}
