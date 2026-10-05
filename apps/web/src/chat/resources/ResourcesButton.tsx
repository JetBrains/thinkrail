import { RiStackFill, RiStackLine } from "@remixicon/react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib";

export function ResourcesButton({
	activeCount,
	open,
	className,
	...props
}: ComponentProps<typeof Button> & { activeCount: number | null; open: boolean }) {
	const Icon = open ? RiStackFill : RiStackLine;
	const live = activeCount !== null && activeCount > 0;
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
