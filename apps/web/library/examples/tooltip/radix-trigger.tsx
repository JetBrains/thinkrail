import { RiDeleteBinLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { PopoverTrigger } from "@thinkrail/ui/popover";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useState } from "react";
import { ConfirmPopover } from "@/panels/ConfirmPopover";

export default function RadixTrigger() {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<ConfirmPopover
			open={open}
			onOpenChange={setOpen}
			title={t("review.panel.clearTitle")}
			description={t("review.panel.clearDescription")}
			confirmLabel={t("review.panel.clear")}
			destructive
			onConfirm={() => {}}
		>
			<IconTooltip label={t("review.panel.clearTooltip")} wrapTrigger>
				<PopoverTrigger asChild>
					<Button variant="ghost" size="m" iconLeft={RiDeleteBinLine}>
						{t("review.panel.clear")}
					</Button>
				</PopoverTrigger>
			</IconTooltip>
		</ConfirmPopover>
	);
}
