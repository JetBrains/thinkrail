import { RiAlertLine as TriangleAlert } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import type { ReactNode } from "react";

export function NoticeDialog({
	open,
	onOpenChange,
	title,
	description,
	dismissLabel,
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
	const t = useT();
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
						{dismissLabel ?? t("panels.noticeDialog.ok")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
