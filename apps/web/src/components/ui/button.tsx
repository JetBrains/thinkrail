import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-sm whitespace-nowrap rounded-[var(--radius-md)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"bg-control-primary-bg text-control-primary-text hover:opacity-90 disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				destructive:
					"bg-feedback-error text-text-on-primary hover:opacity-90 disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				outline:
					"border border-control-border-default bg-control-bg text-text-default hover:bg-control-bg-hovered active:border-control-border-active disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				ghost:
					"text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text",
			},
			size: {
				default: "h-8 px-md tr-text-ui",
				sm: "h-7 px-sm tr-text-ui",
				icon: "size-7",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	ref?: React.Ref<HTMLButtonElement>;
}

export function Button({ className, variant, size, type = "button", ref, ...props }: ButtonProps) {
	return (
		<button
			ref={ref}
			type={type}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { buttonVariants };
