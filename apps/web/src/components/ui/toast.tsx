import * as ToastPrimitive from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib";

const ToastProvider = ToastPrimitive.Provider;

/** The fixed-position stack the toasts portal into — bottom-right on desktop, full-width bottom on mobile. */
function ToastViewport({
	className,
	...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
	return (
		<ToastPrimitive.Viewport
			className={cn(
				"fixed inset-x-0 bottom-0 z-[100] flex max-h-screen w-full flex-col gap-sm p-md outline-none sm:inset-x-auto sm:right-0 sm:bottom-0 sm:w-[380px] sm:max-w-[100vw]",
				className,
			)}
			{...props}
		/>
	);
}

// The left accent bar + icon tint carry the variant; the surface stays the elevated panel so toasts read
// as one family regardless of severity (color signals meaning, it doesn't repaint the whole card).
const toastVariants = cva(
	"group pointer-events-auto relative flex w-full items-start gap-sm overflow-hidden rounded-[var(--radius-md)] border border-l-4 bg-elevated p-md text-text shadow-[var(--shadow-md)] data-[state=closed]:animate-[toast-out_120ms_ease-in] data-[state=open]:animate-[toast-in_150ms_ease-out] data-[swipe=cancel]:translate-x-0 data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[swipe=end]:animate-[toast-out_120ms_ease-in]",
	{
		variants: {
			variant: {
				error: "border-border2 border-l-red",
				success: "border-border2 border-l-green",
				info: "border-border2 border-l-primary",
			},
		},
		defaultVariants: { variant: "info" },
	},
);

function Toast({
	className,
	variant,
	...props
}: React.ComponentProps<typeof ToastPrimitive.Root> & VariantProps<typeof toastVariants>) {
	return <ToastPrimitive.Root className={cn(toastVariants({ variant }), className)} {...props} />;
}

function ToastTitle({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Title>) {
	return <ToastPrimitive.Title className={cn("font-medium text-sm", className)} {...props} />;
}

function ToastDescription({
	className,
	...props
}: React.ComponentProps<typeof ToastPrimitive.Description>) {
	return (
		<ToastPrimitive.Description
			className={cn("text-muted text-sm [overflow-wrap:anywhere]", className)}
			{...props}
		/>
	);
}

/** The dismiss affordance — an icon button that stays out of the way until the toast is hovered/focused. */
function ToastClose({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Close>) {
	return (
		<ToastPrimitive.Close
			aria-label="Dismiss"
			className={cn(
				"-mr-1 -mt-1 ml-auto flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-hint outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary",
				className,
			)}
			{...props}
		>
			<X className="size-3.5" />
		</ToastPrimitive.Close>
	);
}

export {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
	toastVariants,
};
