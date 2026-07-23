import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			className={cn("fixed inset-0 z-50 bg-[var(--overlay)]", className)}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	children,
	hideClose = false,
	overlayClassName,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
	hideClose?: boolean;
	/** Extra classes for the backdrop (e.g. to swap the default `--overlay` scrim for a themed one). */
	overlayClassName?: string;
}) {
	return (
		<DialogPrimitive.Portal>
			<DialogOverlay className={overlayClassName} />
			<DialogPrimitive.Content
				className={cn(
					"-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex w-full max-w-[28rem] flex-col gap-lg rounded-[var(--radius-lg)] border border-border2 bg-elevated p-lg text-text shadow-[var(--shadow-lg)]",
					className,
				)}
				{...props}
			>
				{children}
				{hideClose ? null : (
					<DialogPrimitive.Close className="absolute top-md right-md rounded-[var(--radius-sm)] p-xs text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary">
						<X className="size-4" />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("flex flex-col gap-xs", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("flex flex-col-reverse gap-sm sm:flex-row sm:justify-end", className)}
			{...props}
		/>
	);
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			className={cn("font-semibold text-md text-text leading-none", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
	return <DialogPrimitive.Description className={cn("text-sm text-muted", className)} {...props} />;
}

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
};
