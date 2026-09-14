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
}: ComponentProps<typeof Button> & { activeCount: number; open: boolean }) {
	const Icon = open ? RiStackFill : RiStackLine;
	return (
		<IconTooltip label="Resources" wrapTrigger>
			<Button
				variant="ghost"
				size="sm"
				className={cn(
					"shrink-0 gap-4 tr-text-metadata data-[state=open]:bg-control-bg-selected",
					className,
				)}
				data-testid="resources-trigger"
				data-active-count={activeCount}
				aria-label={`Resources, ${activeCount} active`}
				{...props}
			>
				<Icon className="size-14" />
				<span className="hidden @[480px]:inline">Resources</span>
				<span>{activeCount}</span>
			</Button>
		</IconTooltip>
	);
}
