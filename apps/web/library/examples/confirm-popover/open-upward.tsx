import { RiDeleteBin6Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { PopoverTrigger } from "@thinkrail/ui/popover";
import { useState } from "react";
import { ConfirmPopover } from "@/panels/ConfirmPopover";

export default function OpenUpward() {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<ConfirmPopover
			open={open}
			onOpenChange={setOpen}
			title={t("settings.templates.deleteTitle", { name: "review-checklist" })}
			description={t("settings.templates.deleteDescription")}
			confirmLabel={t("common.delete")}
			destructive
			onConfirm={() => {}}
			side="top"
			align="end"
		>
			<PopoverTrigger asChild>
				<Button variant="outline" size="m" tone="danger" iconLeft={RiDeleteBin6Line}>
					{t("common.delete")}
				</Button>
			</PopoverTrigger>
		</ConfirmPopover>
	);
}
