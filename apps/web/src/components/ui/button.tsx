import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-8 whitespace-nowrap rounded-[var(--radius-sm)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"bg-control-primary-bg text-control-primary-text hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text",
				destructive:
					"bg-feedback-error text-text-on-primary hover:opacity-90 disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				outline:
					"border border-control-border-default bg-control-bg text-text-default hover:bg-control-bg-hovered active:border-control-border-active disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text",
				ghost:
					"text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text",
			},
			size: {
				default: "h-32 px-12 tr-text-ui",
				sm: "h-28 px-8 tr-text-ui",
				icon: "size-28",
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
