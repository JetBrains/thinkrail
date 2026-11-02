import { RiDeleteBin6Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { PopoverTrigger } from "@thinkrail/ui/popover";
import { useState } from "react";
import { ConfirmPopover } from "@/panels/ConfirmPopover";

export default function HeaderAction() {
	const t = useT();
	const [clearing, setClearing] = useState(false);
	return (
		<div className="flex w-full justify-end">
			<ConfirmPopover
				open={clearing}
				onOpenChange={setClearing}
				title={t("review.panel.clearTitle")}
				description={t("review.panel.clearDescription")}
				confirmLabel={t("review.panel.clear")}
				destructive
				onConfirm={() => {}}
				align="end"
			>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="m"
						tone="danger"
						iconLeft={RiDeleteBin6Line}
						aria-label={t("review.panel.clearLabel")}
						tooltip={t("review.panel.clearTooltip")}
						wrapTrigger
					>
						{t("review.panel.clear")}
					</Button>
				</PopoverTrigger>
			</ConfirmPopover>
		</div>
	);
}
