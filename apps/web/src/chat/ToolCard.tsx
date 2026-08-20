import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib";
import { useFold } from "./foldState";
import { getToolRenderer, getToolSummary, resolveProminence } from "./toolRegistry";
import type { ToolResultState } from "./types";

export function ToolCard({
	toolCallId,
	toolName,
	args,
	tool,
	dead = false,
	streaming,
	workspaceRoot,
}: {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	tool: ToolResultState | undefined;
	dead?: boolean;
	streaming: boolean;
	workspaceRoot?: string | undefined;
}) {
	const status = tool?.status ?? (dead ? "error" : "running");
	const isError = status === "error";
	const Renderer = getToolRenderer(toolName);
	const renderProps = {
		toolCallId,
		toolName,
		args,
		result: tool?.raw,
		status,
		workspaceRoot,
		streaming,
	};
	const summary = getToolSummary(toolName, renderProps);

	const autoExpand = isError || (resolveProminence(toolName).defaultExpanded && status === "done");
	const [expanded, toggle] = useFold(toolCallId, autoExpand);

	return (
		<div
			data-testid="tool-card"
			data-tool={toolName}
			data-status={status}
			data-expanded={expanded}
			className="rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg"
		>
			<button
				type="button"
				data-testid="tool-card-toggle"
				aria-expanded={expanded}
				onClick={toggle}
				className="flex w-full cursor-pointer select-none items-center gap-xs px-sm py-xs text-left tr-text-metadata outline-none focus-visible:ring-2 focus-visible:ring-primary"
			>
				{status === "running" ? (
					<Loader2 className="size-3 shrink-0 animate-spin text-text-muted motion-reduce:animate-none" />
				) : isError ? (
					<X className="size-3 shrink-0 text-feedback-error" />
				) : (
					<Check className="size-3 shrink-0 text-feedback-success" />
				)}
				<span className="shrink-0 text-text-default">{toolName}</span>
				{summary ? (
					<span className="min-w-0 flex-1 truncate text-text-muted" title={summary}>
						{summary}
					</span>
				) : (
					<span className="flex-1" />
				)}
				<ChevronRight
					className={`size-3 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
			</button>
			{expanded ? (
				<div className={cn("px-sm pb-xs", isError && "text-feedback-error")}>
					<Renderer {...renderProps} />
				</div>
			) : null}
		</div>
	);
}
