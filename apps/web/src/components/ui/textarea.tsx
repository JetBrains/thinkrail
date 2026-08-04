import type * as React from "react";
import { cn } from "@/lib";

/** A token-themed textarea: hairline `border2`, purple focus ring (matches the composer/prompt inputs). */
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			className={cn(
				"w-full resize-none rounded-[var(--radius-md)] border border-border-default bg-control-bg px-md py-sm tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-subtle focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary-soft disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
