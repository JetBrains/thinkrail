import { RiAlertLine as TriangleAlert } from "@remixicon/react";
import { type ComponentProps, type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";

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
	children: ReactNode;
}) {
	const titleId = useId();
	const descId = useId();
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			{children}
			<PopoverContent
				role="alertdialog"
				aria-labelledby={titleId}
				aria-describedby={description ? descId : undefined}
				side={side}
				align={align}
				className="flex w-288 flex-col gap-8 p-12"
				data-testid="confirm-popover"
			>
				<div className="flex items-center gap-8">
					{destructive ? <TriangleAlert className="size-16 shrink-0 text-feedback-error" /> : null}
					<span id={titleId} className="tr-title-compact text-text-default">
						{title}
					</span>
				</div>
				{description ? (
					<p id={descId} className="tr-text-metadata text-text-muted">
						{description}
					</p>
				) : null}
				<div className="flex justify-end gap-8 pt-4">
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
