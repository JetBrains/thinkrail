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

/**
 * A small reusable confirmation dialog built on the `Dialog` primitive — for destructive actions that
 * need an explicit yes/no (e.g. archiving a workspace). It forces a deliberate choice: the close ✕ is
 * dropped (`hideClose`) so Cancel/Confirm are the only actions (Esc + outside-click still cancel, which
 * is safe), and Cancel comes first in the DOM so it takes the dialog's initial focus (a destructive
 * action is never one stray Enter away). A `destructive` confirm also gets a warning glyph so the weight
 * of the action reads at a glance.
 */
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
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[24rem]" hideClose data-testid="confirm-dialog">
				<DialogHeader>
					<div className="flex items-center gap-sm">
						{destructive ? <TriangleAlert className="size-4 shrink-0 text-red" /> : null}
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
