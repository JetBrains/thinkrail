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
 * A minimal informational modal built on the `Dialog` primitive: a title, a message, and a single
 * acknowledge button — for surfacing a failure that has no yes/no follow-up (e.g. "this folder no longer
 * exists"). Distinct from `ConfirmDialog`, which forces a deliberate yes/no. Errors get a warning glyph.
 * Reusable by the broader error-handling pass; today it surfaces a failed `project.open`.
 */
export function NoticeDialog({
	open,
	onOpenChange,
	title,
	description,
	dismissLabel = "OK",
	tone = "error",
	testId = "notice-dialog",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: ReactNode;
	dismissLabel?: string;
	tone?: "error" | "info";
	testId?: string;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[24rem]" hideClose data-testid={testId}>
				<DialogHeader>
					<div className="flex items-center gap-sm">
						{tone === "error" ? <TriangleAlert className="size-4 shrink-0 text-red" /> : null}
						<DialogTitle>{title}</DialogTitle>
					</div>
					{description ? <DialogDescription>{description}</DialogDescription> : null}
				</DialogHeader>
				<DialogFooter>
					<Button data-testid="notice-dismiss" onClick={() => onOpenChange(false)}>
						{dismissLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
