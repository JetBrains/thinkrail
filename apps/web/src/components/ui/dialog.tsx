import * as DialogPrimitive from "@radix-ui/react-dialog";
import { RiCloseLine as X } from "@remixicon/react";
import type * as React from "react";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib";

let overlayCount = 0;
const overlayListeners = new Set<() => void>();

function publishOverlayCount(next: number): void {
	overlayCount = next;
	for (const listener of overlayListeners) listener();
}

function subscribeOverlayCount(listener: () => void): () => void {
	overlayListeners.add(listener);
	return () => {
		overlayListeners.delete(listener);
	};
}

export function dialogOverlayIsOpen(): boolean {
	return overlayCount > 0;
}

export function useDialogOverlayOpen(): boolean {
	return useSyncExternalStore(subscribeOverlayCount, dialogOverlayIsOpen, () => false);
}

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
	useLayoutEffect(() => {
		publishOverlayCount(overlayCount + 1);
		return () => publishOverlayCount(Math.max(0, overlayCount - 1));
	}, []);
	return (
		<DialogPrimitive.Overlay
			data-testid="dialog-overlay"
			className={cn("fixed inset-0 z-50 bg-overlay", className)}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	children,
	hideClose = false,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
	return (
		<DialogPrimitive.Portal>
			<DialogOverlay />
			<DialogPrimitive.Content
				className={cn(
					"-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex w-full max-w-[28rem] flex-col gap-16 rounded-[var(--radius-lg)] border border-border-default bg-container-elevated-bg p-16 text-text-default shadow-[var(--shadow-lg)]",
					className,
				)}
				{...props}
			>
				{children}
				{hideClose ? null : (
					<DialogPrimitive.Close className="absolute top-12 right-12 rounded-[var(--radius-sm)] p-4 text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary">
						<X className="size-16" />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("flex flex-col gap-4", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("flex flex-col-reverse gap-8 sm:flex-row sm:justify-end", className)}
			{...props}
		/>
	);
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			className={cn("tr-title-dialog text-text-default", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			className={cn("tr-text-ui text-text-muted", className)}
			{...props}
		/>
	);
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
