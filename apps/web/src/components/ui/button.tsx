import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-sm whitespace-nowrap rounded-[var(--radius-md)] font-sans font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-primary text-on-accent hover:opacity-90",
				outline: "border border-border2 bg-elevated text-text hover:bg-hover",
				ghost: "text-muted hover:bg-hover hover:text-text",
			},
			size: {
				default: "h-8 px-md text-sm",
				sm: "h-7 px-sm text-sm",
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
		VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
	return (
		<button type={type} className={cn(buttonVariants({ variant, size, className }))} {...props} />
	);
}

export { buttonVariants };
