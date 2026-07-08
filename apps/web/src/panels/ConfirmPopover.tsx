import { TriangleAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";

/**
 * A small reusable confirmation popover built on the `Popover` primitive — for destructive actions that
 * need an explicit yes/no anchored to the thing they act on (e.g. removing a workspace opens it right
 * beneath that row). The caller supplies the anchor/trigger as `children` (a `PopoverAnchor` +
 * `PopoverTrigger`); this renders the confirm body in `PopoverContent`.
 *
 * It keeps the same deliberate-choice contract as a modal confirm: Cancel comes first in the DOM so it
 * takes the popover's initial focus (a destructive action is never one stray Enter away), Esc +
 * outside-click cancel (safe), and a `destructive` confirm gets a warning glyph + red button so the
 * weight of the action reads at a glance.
 */
export function ConfirmPopover({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	destructive = false,
	confirmTestId,
	onConfirm,
	side = "bottom",
	align = "start",
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	confirmTestId?: string;
	onConfirm: () => void;
	side?: ComponentProps<typeof PopoverContent>["side"];
	align?: ComponentProps<typeof PopoverContent>["align"];
	/** The anchor/trigger for the popover — typically a `PopoverAnchor` wrapping a row plus a `PopoverTrigger`. */
	children: ReactNode;
}) {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			{children}
			<PopoverContent
				side={side}
				align={align}
				className="flex w-72 flex-col gap-sm p-md"
				data-testid="confirm-popover"
			>
				<div className="flex items-center gap-sm">
					{destructive ? <TriangleAlert className="size-4 shrink-0 text-red" /> : null}
					<span className="font-medium text-sm text-text">{title}</span>
				</div>
				{description ? <p className="text-xs text-muted">{description}</p> : null}
				<div className="flex justify-end gap-sm pt-xs">
					<Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
						{cancelLabel}
					</Button>
					<Button
						variant={destructive ? "destructive" : "default"}
						size="sm"
						data-testid={confirmTestId}
						onClick={() => {
							onConfirm();
							onOpenChange(false);
						}}
					>
						{confirmLabel}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
