import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib";
import { getToolRenderer } from "./toolRegistry";
import type { ToolResultState } from "./types";

/**
 * A tool call paired with its result, in one card. The body comes from the tool-renderer registry
 * (default = pretty-printed args/result); the header + status icon are shared chrome. Presentational.
 */
export function ToolCard({
	toolName,
	args,
	tool,
}: {
	toolName: string;
	args: Record<string, unknown>;
	tool: ToolResultState | undefined;
}) {
	const status = tool?.status ?? "running";
	const Renderer = getToolRenderer(toolName);
	return (
		<div
			data-testid="tool-card"
			data-tool={toolName}
			data-status={status}
			className="rounded-[var(--radius-sm)] border border-border2 bg-elevated"
		>
			<div className="flex items-center gap-xs px-sm py-xs text-xs">
				{status === "running" ? (
					<Loader2 className="size-3 animate-spin text-muted" />
				) : status === "error" ? (
					<X className="size-3 text-red" />
				) : (
					<Check className="size-3 text-green" />
				)}
				<span className="font-medium text-text">{toolName}</span>
			</div>
			<div className={cn("px-sm pb-xs", status === "error" && "text-red")}>
				<Renderer toolName={toolName} args={args} result={tool?.raw} status={status} />
			</div>
		</div>
	);
}
