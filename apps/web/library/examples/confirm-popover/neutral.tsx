import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { PopoverTrigger } from "@thinkrail/ui/popover";
import { useState } from "react";
import { ConfirmPopover } from "@/panels/ConfirmPopover";

export default function Neutral() {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<ConfirmPopover
			open={open}
			onOpenChange={setOpen}
			title={t("workbench.layoutSettings.applyTitle")}
			description={t("workbench.layoutSettings.applyDescription")}
			confirmLabel={t("workbench.layoutSettings.applyConfirm")}
			onConfirm={() => {}}
		>
			<PopoverTrigger asChild>
				<Button variant="outline" size="m">
					{t("workbench.layoutSettings.applyNow")}
				</Button>
			</PopoverTrigger>
		</ConfirmPopover>
	);
}
