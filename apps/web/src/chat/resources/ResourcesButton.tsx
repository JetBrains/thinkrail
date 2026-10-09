import { RiErrorWarningLine, RiStackFill, RiStackLine } from "@remixicon/react";
import { Button } from "@thinkrail/ui/button";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import type { ComponentProps } from "react";

export function ResourcesButton({
	activeCount,
	open,
	working,
	className,
	...props
}: ComponentProps<typeof Button> & {
	activeCount: number | null;
	open: boolean;
	working?: boolean;
}) {
	const Icon = open ? RiStackFill : RiStackLine;
	const live = working ?? (activeCount !== null && activeCount > 0);
	const countLabel = activeCount === null ? "active count unavailable" : `${activeCount} active`;
	return (
		<IconTooltip
			label={activeCount === null ? "Resources — active count unavailable" : "Resources"}
			wrapTrigger
		>
			<Button
				variant="ghost"
				size="sm"
				className={cn(
					"shrink-0 gap-4 tr-text-metadata aria-expanded:bg-control-bg-selected",
					className,
				)}
				data-testid="resources-trigger"
				data-active-count={activeCount ?? "unknown"}
				data-live={live || undefined}
				aria-label={`Resources, ${countLabel}`}
				aria-expanded={open}
				{...props}
			>
				<Icon className={cn("size-14", live && "motion-safe:animate-working")} />
				<span className="hidden @[480px]:inline">Resources</span>
				<span className="tabular-nums">{activeCount ?? "—"}</span>
			</Button>
		</IconTooltip>
	);
}

export function ResourcesAttention({ count, onOpen }: { count: number; onOpen: () => void }) {
	const label = `${count} MCP server${count === 1 ? " needs" : "s need"} attention — open MCP settings`;
	return (
		<IconTooltip label={label}>
			<Button
				variant="ghost"
				size="icon"
				data-testid="resources-mcp-attention"
				data-count={count}
				aria-label={label}
				onClick={onOpen}
				className="shrink-0 text-feedback-warning hover:text-feedback-warning"
			>
				<RiErrorWarningLine className="size-14" />
			</Button>
		</IconTooltip>
	);
}
