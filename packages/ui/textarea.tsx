import type * as React from "react";
import { cn } from "./utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			className={cn(
				"w-full resize-none rounded-sm border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default transition-colors placeholder:text-text-muted focus-visible:border-control-border-active focus-visible:focus-ring disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				className,
			)}
			{...props}
		/>
	);
}
