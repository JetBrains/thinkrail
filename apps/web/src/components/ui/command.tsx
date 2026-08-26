import { RiSearchLine as Search } from "@remixicon/react";
import { Command as CommandPrimitive } from "cmdk";
import type * as React from "react";
import { cn } from "@/lib";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
	return (
		<CommandPrimitive
			className={cn(
				"flex w-full flex-col overflow-hidden bg-container-elevated-bg text-text-default",
				className,
			)}
			{...props}
		/>
	);
}

function CommandInput({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
	return (
		<div className="flex items-center gap-4 border-border-muted border-b px-8">
			<Search className="size-14 shrink-0 text-text-muted" />
			<CommandPrimitive.Input
				className={cn(
					"h-36 flex-1 bg-transparent tr-text-ui text-text-default outline-none placeholder:text-text-muted",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
	return (
		<CommandPrimitive.List
			className={cn("max-h-[280px] overflow-y-auto overflow-x-hidden p-4", className)}
			{...props}
		/>
	);
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return (
		<CommandPrimitive.Empty className="py-12 text-center text-text-muted tr-text-ui" {...props} />
	);
}

function CommandGroup({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
	return (
		<CommandPrimitive.Group
			className={cn(
				"[&_[cmdk-group-heading]]:px-8 [&_[cmdk-group-heading]]:py-4 [&_[cmdk-group-heading]]:text-text-muted",
				className,
			)}
			{...props}
		/>
	);
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
	return (
		<CommandPrimitive.Item
			className={cn(
				"flex cursor-pointer items-center gap-4 rounded-[var(--radius-sm)] px-8 py-4 tr-text-ui text-text-default outline-none data-[selected=true]:bg-control-bg-selected",
				className,
			)}
			{...props}
		/>
	);
}

function CommandSeparator({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
	return (
		<CommandPrimitive.Separator className={cn("my-4 h-px bg-border-muted", className)} {...props} />
	);
}

export {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
};
