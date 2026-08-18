import type * as React from "react";
import { cn } from "@/lib";

/** A token-themed textarea: hairline `border2`, purple focus ring (matches the composer/prompt inputs). */
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			className={cn(
				"w-full resize-none rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-md py-sm tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary-soft disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				className,
			)}
			{...props}
		/>
	);
}
