import type * as React from "react";
import { cn } from "@/lib";

/** A token-themed textarea: hairline neutral border that strengthens to `control-border-active` while
 * editing (matches the composer's neutral active border). No accent ring — focus/active stays neutral. */
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			className={cn(
				"w-full resize-none rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-md py-sm tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus-visible:border-control-border-active disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				className,
			)}
			{...props}
		/>
	);
}
