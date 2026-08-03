import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import type * as React from "react";
import { cn } from "@/lib";
import { menuContentClass, menuItemClass, menuSeparatorClass } from "./menu-styles";

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

function ContextMenuContent({
	className,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Content
				className={cn(
					menuContentClass,
					"max-h-[min(60vh,var(--radix-context-menu-content-available-height))]",
					className,
				)}
				{...props}
			/>
		</ContextMenuPrimitive.Portal>
	);
}

function ContextMenuItem({
	className,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
	return <ContextMenuPrimitive.Item className={cn(menuItemClass, className)} {...props} />;
}

function ContextMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
	return (
		<ContextMenuPrimitive.Separator className={cn(menuSeparatorClass, className)} {...props} />
	);
}

export {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
};
