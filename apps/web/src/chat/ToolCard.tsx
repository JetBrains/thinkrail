import {
	RiCheckLine as Check,
	RiArrowRightSLine as ChevronRight,
	RiLoader4Line as Loader2,
	RiCloseLine as X,
} from "@remixicon/react";
import { cn } from "@/lib";
import { useFold } from "./foldState";
import { ToolRendererBody } from "./ToolRendererBody";
import { getToolSummary, resolveProminence } from "./toolRegistry";
import type { ToolResultState } from "./types";

export function ToolCard({
	toolCallId,
	toolName,
	args,
	tool,
	dead = false,
	streaming,
	workspaceRoot,
	onOpenFile,
}: {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	tool: ToolResultState | undefined;
	dead?: boolean;
	streaming: boolean;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const status = tool?.status ?? (dead ? "error" : "running");
	const isError = status === "error";
	const renderProps = {
		toolCallId,
		toolName,
		args,
		result: tool?.raw,
		status,
		workspaceRoot,
		onOpenFile,
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
				className="flex w-full cursor-pointer select-none items-center gap-4 px-8 py-4 text-left tr-text-metadata outline-none focus-visible:ring-2 focus-visible:ring-primary"
			>
				{status === "running" ? (
					<Loader2 className="size-12 shrink-0 animate-spin text-text-muted motion-reduce:animate-none" />
				) : isError ? (
					<X className="size-12 shrink-0 text-feedback-error" />
				) : (
					<Check className="size-12 shrink-0 text-feedback-success" />
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
					className={`size-16 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
			</button>
			{expanded ? (
				<div className={cn("px-8 pb-4", isError && "text-feedback-error")}>
					<ToolRendererBody {...renderProps} imageLabel={summary} />
				</div>
			) : null}
		</div>
	);
}
