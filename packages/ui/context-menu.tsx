import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import type * as React from "react";
import { menuContentClass, menuItemClass, menuSeparatorClass } from "./menu-styles";
import { cn } from "./utils";

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

function openContextMenuFromKeyboard(event: React.KeyboardEvent<HTMLElement>) {
	if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
	event.preventDefault();
	const rect = event.currentTarget.getBoundingClientRect();
	event.currentTarget.dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, clientX: rect.left, clientY: rect.bottom }),
	);
}

export {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	openContextMenuFromKeyboard,
};
