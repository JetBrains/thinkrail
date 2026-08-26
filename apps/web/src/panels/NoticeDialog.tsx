import { RiAlertLine as TriangleAlert } from "@remixicon/react";
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
					<div className="flex items-center gap-8">
						{tone === "error" ? (
							<TriangleAlert className="size-16 shrink-0 text-feedback-error" />
						) : null}
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
