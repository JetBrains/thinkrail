import * as ToastPrimitive from "@radix-ui/react-toast";
import { RiCloseLine as X } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "./utils";

const ToastProvider = ToastPrimitive.Provider;

function ToastViewport({
	className,
	...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
	return (
		<ToastPrimitive.Viewport
			className={cn(
				"fixed inset-x-0 bottom-0 z-[100] flex max-h-screen w-full flex-col gap-8 p-12 outline-none sm:inset-x-auto sm:right-0 sm:bottom-0 sm:w-[380px] sm:max-w-[100vw]",
				className,
			)}
			{...props}
		/>
	);
}

const toastVariants = cva(
	"group pointer-events-auto relative flex w-full flex-col overflow-hidden rounded-sm border bg-container-elevated-bg p-12 text-text-default shadow-[var(--shadow-md)] data-[state=closed]:animate-[toast-out_120ms_ease-in] data-[state=open]:animate-[toast-in_150ms_ease-out] data-[swipe=cancel]:translate-x-0 data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[swipe=end]:animate-[toast-out_120ms_ease-in]",
	{
		variants: {
			variant: {
				error: "border-feedback-error-muted",
				success: "border-feedback-success-muted",
				warning: "border-feedback-warning-muted",
				info: "border-feedback-info-muted",
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
	return <ToastPrimitive.Title className={cn("tr-title-compact", className)} {...props} />;
}

function ToastDescription({
	className,
	...props
}: React.ComponentProps<typeof ToastPrimitive.Description>) {
	return (
		<ToastPrimitive.Description
			className={cn("text-text-muted tr-text-ui [overflow-wrap:anywhere]", className)}
			{...props}
		/>
	);
}

function ToastAction({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Action>) {
	return <ToastPrimitive.Action className={className} {...props} />;
}

function ToastClose({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Close>) {
	const t = useT();
	return (
		<ToastPrimitive.Close
			aria-label={t("common.dismiss")}
			className={cn(
				"ml-auto flex size-24 shrink-0 items-center justify-center rounded-sm text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary",
				className,
			)}
			{...props}
		>
			<X className="size-14" />
		</ToastPrimitive.Close>
	);
}

export {
	Toast,
	ToastAction,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
	toastVariants,
};
