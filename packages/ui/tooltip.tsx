import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "./utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({
	className,
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				sideOffset={sideOffset}
				className={cn(
					"z-150 overflow-hidden rounded-sm border border-border-default bg-container-elevated-bg px-8 py-4 text-text-default tr-text-metadata shadow-[var(--shadow-sm)]",
					className,
				)}
				{...props}
			/>
		</TooltipPrimitive.Portal>
	);
}

function IconTooltip({
	label,
	side,
	align,
	wrapTrigger,
	children,
}: {
	label: React.ReactNode;
	side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
	align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"];
	wrapTrigger?: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const quietFocus = useRef(false);
	const onFocus = (event: React.FocusEvent) => {
		quietFocus.current = !event.target.matches(":focus-visible");
		queueMicrotask(() => {
			quietFocus.current = false;
		});
	};
	const onOpenChange = (next: boolean) => {
		if (next && quietFocus.current) return;
		setOpen(next);
	};
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") flushSync(() => setOpen(false));
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [open]);
	return (
		<Tooltip open={open} onOpenChange={onOpenChange}>
			{wrapTrigger ? (
				<TooltipTrigger asChild onFocus={onFocus}>
					<span className="flex">{children}</span>
				</TooltipTrigger>
			) : (
				<TooltipTrigger asChild onFocus={onFocus}>
					{children}
				</TooltipTrigger>
			)}
			<TooltipContent {...(side ? { side } : {})} {...(align ? { align } : {})}>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

export { IconTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
