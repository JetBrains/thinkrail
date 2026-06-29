import * as PopoverPrimitive from "@radix-ui/react-popover";
import type * as React from "react";
import { cn } from "@/lib";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({
	className,
	align = "center",
	sideOffset = 6,
	container,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
	/**
	 * Portal target. Defaults to `document.body`. Pass the host Dialog's content node when the popover
	 * lives inside a Radix Dialog — otherwise `react-remove-scroll` (the Dialog's scroll lock) blocks
	 * wheel/trackpad scrolling on body-portaled content.
	 */
	container?: HTMLElement | null | undefined;
}) {
	return (
		<PopoverPrimitive.Portal container={container ?? undefined}>
			<PopoverPrimitive.Content
				align={align}
				sideOffset={sideOffset}
				className={cn(
					"z-50 overflow-hidden rounded-[var(--radius-md)] border border-border2 bg-elevated text-text shadow-[var(--shadow-md)] outline-none",
					className,
				)}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	);
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
