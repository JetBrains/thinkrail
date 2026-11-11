import * as PopoverPrimitive from "@radix-ui/react-popover";
import type * as React from "react";
import { yieldEscapeToIme } from "./keyboard";
import { cn } from "./utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({
	className,
	align = "center",
	sideOffset = 6,
	container,
	onEscapeKeyDown,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
	container?: HTMLElement | null | undefined;
}) {
	return (
		<PopoverPrimitive.Portal container={container ?? undefined}>
			<PopoverPrimitive.Content
				align={align}
				sideOffset={sideOffset}
				className={cn(
					"z-50 overflow-hidden rounded-md border border-border-default bg-container-elevated-bg text-text-default shadow-[var(--shadow-md)] outline-none",
					className,
				)}
				onEscapeKeyDown={yieldEscapeToIme(onEscapeKeyDown)}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	);
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
