import { useT } from "@thinkrail/locales/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { useState } from "react";
import { FileChip } from "@/chat/FileChip";

export default function Attachment() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const label = "favicon.svg";
	return (
		<>
			<FileChip
				title={label}
				aria-label={t("chat.turn.viewAttachment", { label })}
				onClick={() => setOpen(true)}
				label={label}
			/>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="flex w-auto flex-col gap-8">
					<DialogHeader>
						<DialogTitle>{label}</DialogTitle>
					</DialogHeader>
					<img src="favicon.svg" alt="" className="h-auto w-[16rem] max-w-full rounded-sm" />
				</DialogContent>
			</Dialog>
		</>
	);
}
