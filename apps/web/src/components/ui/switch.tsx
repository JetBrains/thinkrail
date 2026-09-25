import type * as React from "react";
import { cn } from "@/lib";

export function Switch({
	checked,
	onCheckedChange,
	className,
	...props
}: Omit<React.ComponentProps<"button">, "onChange" | "role" | "type"> & {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			{...props}
			data-active={checked}
			onClick={() => onCheckedChange(!checked)}
			className={cn(
				"relative h-20 w-36 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50",
				checked ? "bg-primary" : "bg-border-default",
				className,
			)}
		>
			<span
				className={cn(
					"absolute top-2 left-2 size-16 rounded-full bg-container-workspace-bg transition-transform",
					checked && "translate-x-16",
				)}
			/>
		</button>
	);
}
