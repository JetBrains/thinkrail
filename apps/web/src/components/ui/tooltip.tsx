import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type * as React from "react";
import { cn } from "@/lib";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({
	className,
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				sideOffset={sideOffset}
				className={cn(
					"z-50 overflow-hidden rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-8 py-4 text-text-default tr-text-metadata shadow-[var(--shadow-sm)]",
					className,
				)}
				{...props}
			/>
		</TooltipPrimitive.Portal>
	);
}

function IconTooltip({
	label,
	side,
	align,
	wrapTrigger,
	children,
}: {
	label: React.ReactNode;
	side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
	align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"];
	wrapTrigger?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Tooltip>
			{wrapTrigger ? (
				<TooltipTrigger asChild>
					<span className="flex">{children}</span>
				</TooltipTrigger>
			) : (
				<TooltipTrigger asChild>{children}</TooltipTrigger>
			)}
			<TooltipContent {...(side ? { side } : {})} {...(align ? { align } : {})}>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

export { IconTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
