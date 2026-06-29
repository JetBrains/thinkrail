import type * as React from "react";
import { cn } from "@/lib";

/** A token-themed textarea: hairline `border2`, purple focus ring (matches the composer/prompt inputs). */
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			className={cn(
				"w-full resize-none rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-md py-sm text-sm text-text outline-none transition-colors placeholder:text-hint focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--primary-20)] disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
