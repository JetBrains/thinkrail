import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib";

/** A token-themed cmdk command palette — the searchable combobox body inside a Popover (branch/model pickers). */
function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
	return (
		<CommandPrimitive
			className={cn("flex w-full flex-col overflow-hidden bg-elevated text-text", className)}
			{...props}
		/>
	);
}

function CommandInput({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
	return (
		<div className="flex items-center gap-sm border-border border-b px-sm">
			<Search className="size-3.5 shrink-0 text-hint" />
			<CommandPrimitive.Input
				className={cn(
					"h-9 flex-1 bg-transparent tr-text-ui text-text outline-none placeholder:text-hint",
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
			className={cn("max-h-[280px] overflow-y-auto overflow-x-hidden p-xs", className)}
			{...props}
		/>
	);
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return <CommandPrimitive.Empty className="py-md text-center text-hint tr-text-ui" {...props} />;
}

function CommandGroup({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
	// cmdk renders the heading element itself, so a semantic typography class cannot be put on it — and
	// an arbitrary variant cannot apply one. Spacing + colour only; a caller that wants the heading
	// styled passes a node: `heading={<span className="tr-text-eyebrow">Remote</span>}`.
	return (
		<CommandPrimitive.Group
			className={cn(
				"[&_[cmdk-group-heading]]:px-sm [&_[cmdk-group-heading]]:py-xs [&_[cmdk-group-heading]]:text-hint",
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
				"flex cursor-pointer items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs tr-text-ui text-text outline-none data-[selected=true]:bg-hover",
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
		<CommandPrimitive.Separator className={cn("my-xs h-px bg-border", className)} {...props} />
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
