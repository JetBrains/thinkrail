import { RiDeleteBin6Line, RiPencilLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { PopoverTrigger } from "@thinkrail/ui/popover";
import { useState } from "react";
import { ConfirmPopover } from "@/panels/ConfirmPopover";

export default function Preview() {
	const t = useT();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const name = "review-checklist";
	return (
		<ConfirmPopover
			open={confirmOpen}
			onOpenChange={setConfirmOpen}
			title={t("settings.templates.deleteTitle", { name })}
			description={t("settings.templates.deleteDescription")}
			confirmLabel={t("common.delete")}
			destructive
			onConfirm={() => {}}
			align="end"
		>
			<div className="flex w-full max-w-[24rem] items-center gap-8 rounded-sm bg-control-bg px-12 py-8">
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate tr-text-ui text-text-default">{name}</span>
					<span className="truncate tr-text-metadata text-text-muted">
						Walk the diff against the checklist
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-4">
					<IconButton icon={RiPencilLine} label={t("common.edit")} onClick={() => {}} />
					<PopoverTrigger asChild>
						<IconButton
							icon={RiDeleteBin6Line}
							label={t("common.delete")}
							tone="danger"
							wrapTrigger
						/>
					</PopoverTrigger>
				</div>
			</div>
		</ConfirmPopover>
	);
}
