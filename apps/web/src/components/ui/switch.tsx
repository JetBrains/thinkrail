import type * as React from "react";
import { cn } from "@/lib";

export interface SwitchProps
	extends Omit<
		React.ButtonHTMLAttributes<HTMLButtonElement>,
		"aria-checked" | "aria-label" | "onChange" | "role" | "type"
	> {
	checked: boolean;
	label: string;
	testId?: string;
	onCheckedChange: (checked: boolean) => void;
	ref?: React.Ref<HTMLButtonElement>;
}

export function Switch({
	checked,
	label,
	testId,
	onCheckedChange,
	className,
	disabled = false,
	onClick,
	ref,
	...props
}: SwitchProps) {
	return (
		<button
			{...props}
			ref={ref}
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			data-testid={testId}
			data-active={checked}
			disabled={disabled}
			onClick={(event) => {
				onClick?.(event);
				if (!disabled && !event?.defaultPrevented) onCheckedChange(!checked);
			}}
			className={cn(
				"grid h-24 w-40 shrink-0 place-items-center rounded-full bg-transparent outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:hover:bg-transparent motion-reduce:transition-none",
				className,
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"relative h-20 w-36 rounded-full transition-colors motion-reduce:transition-none",
					disabled
						? checked
							? "bg-control-primary-disabled-bg"
							: "bg-control-disabled-border"
						: checked
							? "bg-primary"
							: "bg-border-default",
				)}
			>
				<span
					className={cn(
						"absolute top-2 left-2 size-16 rounded-full transition-transform motion-reduce:transition-none",
						disabled
							? "bg-control-disabled-text"
							: checked
								? "bg-control-primary-text"
								: "bg-container-workspace-bg",
						checked && "translate-x-16",
					)}
				/>
			</span>
		</button>
	);
}
