import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib";
import { useFold } from "./foldState";
import { getToolRenderer, getToolSummary, resolveProminence } from "./toolRegistry";
import type { ToolResultState } from "./types";

/**
 * A tool call paired with its result, in one card. The body comes from the tool-renderer registry
 * (default = pretty-printed args/result); the header + status icon are shared chrome. Presentational.
 *
 * Collapsed by default — the header carries a one-line summary (the registered {@link getToolSummary})
 * so a collapsed card still reads at a glance; click the header to reveal the body. Two auto-expands,
 * both losing to a manual toggle: errors (failures stay visible), and a registered `defaultExpanded`
 * once the call completes (e.g. `visualize` — while its args stream it stays a slim running row).
 * The manual choice lives in the shared fold cache (keyed by `toolCallId`), so it survives
 * virtualization — a deliberately collapsed `defaultExpanded` card must not pop back open when
 * scrolled away and back.
 * A call on a dead message (`dead`) renders as errored — pi never executes it, so it must not spin.
 */
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
	/** Owning message aborted/errored — the call will never execute. */
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

	// Auto-expand on error, or — for a `defaultExpanded` registration — on completion. The default only
	// applies until the user toggles; the cached manual choice then wins (see `useFold`).
	const autoExpand = isError || (resolveProminence(toolName).defaultExpanded && status === "done");
	const [expanded, toggle] = useFold(toolCallId, autoExpand);

	return (
		<div
			data-testid="tool-card"
			data-tool={toolName}
			data-status={status}
			data-expanded={expanded}
			className="rounded-[var(--radius-sm)] border border-border2 bg-elevated"
		>
			<button
				type="button"
				data-testid="tool-card-toggle"
				aria-expanded={expanded}
				onClick={toggle}
				className="flex w-full cursor-pointer select-none items-center gap-xs px-sm py-xs text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
			>
				{status === "running" ? (
					<Loader2 className="size-3 shrink-0 animate-spin text-muted motion-reduce:animate-none" />
				) : isError ? (
					<X className="size-3 shrink-0 text-red" />
				) : (
					<Check className="size-3 shrink-0 text-green" />
				)}
				<span className="shrink-0 font-medium text-text">{toolName}</span>
				{summary ? (
					<span className="min-w-0 flex-1 truncate text-muted" title={summary}>
						{summary}
					</span>
				) : (
					<span className="flex-1" />
				)}
				<ChevronRight
					className={`size-3 shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
			</button>
			{expanded ? (
				<div className={cn("px-sm pb-xs", isError && "text-red")}>
					<Renderer {...renderProps} />
				</div>
			) : null}
		</div>
	);
}
