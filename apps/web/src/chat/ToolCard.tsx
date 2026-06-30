import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib";
import { getToolRenderer, getToolSummary } from "./toolRegistry";
import type { ToolResultState } from "./types";

/**
 * A tool call paired with its result, in one card. The body comes from the tool-renderer registry
 * (default = pretty-printed args/result); the header + status icon are shared chrome. Presentational.
 *
 * Collapsed by default so routine tool calls (bash/read/edit/…) don't clutter the chat — the header
 * carries a one-line summary (the registered {@link getToolSummary}) so a collapsed card still reads at
 * a glance; click the header to reveal the body. Errors auto-expand so failures stay visible, but a
 * manual toggle wins thereafter.
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
	const isError = status === "error";
	const Renderer = getToolRenderer(toolName);
	const summary = getToolSummary(toolName, { toolName, args, result: tool?.raw, status });

	const [expanded, setExpanded] = useState(isError);
	const userToggled = useRef(false);
	useEffect(() => {
		if (!userToggled.current && isError) setExpanded(true);
	}, [isError]);
	const toggle = () => {
		userToggled.current = true;
		setExpanded((e) => !e);
	};

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
				onClick={toggle}
				className="flex w-full cursor-pointer select-none items-center gap-xs px-sm py-xs text-left text-xs"
			>
				{status === "running" ? (
					<Loader2 className="size-3 shrink-0 animate-spin text-muted" />
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
					<Renderer toolName={toolName} args={args} result={tool?.raw} status={status} />
				</div>
			) : null}
		</div>
	);
}
