import { RiDeleteBin6Line, RiSendPlaneLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { PopoverTrigger } from "@thinkrail/ui/popover";
import { useState } from "react";
import { ConfirmPopover } from "@/panels/ConfirmPopover";

export default function TitleOnly() {
	const t = useT();
	const [confirmDelete, setConfirmDelete] = useState(false);
	return (
		<div className="flex items-center gap-4">
			<IconButton size="s" icon={RiSendPlaneLine} label={t("review.comment.send")} />
			<ConfirmPopover
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title={t("review.panel.deleteTitle")}
				confirmLabel={t("common.delete")}
				destructive
				onConfirm={() => {}}
				align="end"
			>
				<PopoverTrigger asChild>
					<IconButton
						size="s"
						icon={RiDeleteBin6Line}
						label={t("review.comment.deleteDraft")}
						tone="danger"
						wrapTrigger
					/>
				</PopoverTrigger>
			</ConfirmPopover>
		</div>
	);
}
