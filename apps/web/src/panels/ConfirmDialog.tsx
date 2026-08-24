import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	destructive = false,
	confirmTestId,
	onConfirm,
	onClosedAutoFocus,
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
	onClosedAutoFocus?: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				role="alertdialog"
				className="max-w-[24rem]"
				hideClose
				data-testid="confirm-dialog"
				onCloseAutoFocus={
					onClosedAutoFocus
						? (event) => {
								event.preventDefault();
								onClosedAutoFocus();
							}
						: undefined
				}
			>
				<DialogHeader>
					<div className="flex items-center gap-8">
						{destructive ? (
							<TriangleAlert className="size-16 shrink-0 text-feedback-error" />
						) : null}
						<DialogTitle>{title}</DialogTitle>
					</div>
					{description ? <DialogDescription>{description}</DialogDescription> : null}
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{cancelLabel}
					</Button>
					<Button
						variant={destructive ? "destructive" : "default"}
						data-testid={confirmTestId}
						onClick={() => {
							onConfirm();
							onOpenChange(false);
						}}
					>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
