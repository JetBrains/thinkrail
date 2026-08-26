import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib";
import { menuContentClass, menuItemClass, menuSeparatorClass } from "./menu-styles";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;

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
					menuContentClass,
					"max-h-[min(60vh,var(--radix-dropdown-menu-content-available-height))]",
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
	return <DropdownMenuPrimitive.Item className={cn(menuItemClass, className)} {...props} />;
}

function DropdownMenuRadioItem({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
	return <DropdownMenuPrimitive.RadioItem className={cn(menuItemClass, className)} {...props} />;
}

function DropdownMenuSubTrigger({
	className,
	children,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
	return (
		<DropdownMenuPrimitive.SubTrigger
			className={cn(menuItemClass, "data-[state=open]:bg-control-bg-selected", className)}
			{...props}
		>
			{children}
			<ChevronRight className="ml-auto" />
		</DropdownMenuPrimitive.SubTrigger>
	);
}

function DropdownMenuSubContent({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.SubContent
				className={cn(
					"z-50 min-w-[10rem] max-h-[min(60vh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overflow-x-hidden rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-4 text-text-default shadow-[var(--shadow-md)]",
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

function DropdownMenuLabel({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
	return (
		<DropdownMenuPrimitive.Label
			className={cn("px-8 py-4 tr-text-eyebrow text-text-muted", className)}
			{...props}
		/>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
	return (
		<DropdownMenuPrimitive.Separator className={cn(menuSeparatorClass, className)} {...props} />
	);
}

export {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
};
