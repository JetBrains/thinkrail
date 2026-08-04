import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type * as React from "react";
import { cn } from "@/lib";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;

function DropdownMenuContent({
	className,
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				sideOffset={sideOffset}
				className={cn(
					// Bounded + scrollable: a long menu (the Changes scope menu lists up to 200 commits) must never
					// run its rows past the viewport edge where they are unreachable. Radix reports the space it
					// has; we cap at 60vh so the menu never swallows the screen either. Vertical scrolling only —
					// `overflow-y-auto` alone leaves `overflow-x` at `auto`, so a wide row (a long commit subject)
					// would add a horizontal scrollbar to a menu whose rows are supposed to truncate.
					"z-50 min-w-[12rem] max-h-[min(60vh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overflow-x-hidden rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-xs text-text-default shadow-[var(--shadow-md)]",
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

function DropdownMenuItem({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
	return (
		<DropdownMenuPrimitive.Item
			className={cn(
				"relative flex cursor-default select-none items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs tr-text-ui text-text-default outline-none transition-colors focus:bg-control-bg-hovered data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-muted",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuLabel({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
	return (
		<DropdownMenuPrimitive.Label
			className={cn("px-sm py-xs tr-text-eyebrow text-text-muted", className)}
			{...props}
		/>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
	return (
		<DropdownMenuPrimitive.Separator
			className={cn("-mx-xs my-xs h-px bg-border-default", className)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
};
