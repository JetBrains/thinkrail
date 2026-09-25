import type * as React from "react";
import { cn } from "@/lib";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			className={cn(
				"h-28 w-full min-w-0 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				className,
			)}
			{...props}
		/>
	);
}
