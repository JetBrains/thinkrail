import { RiPlayLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";

export default function DisabledReason() {
	const t = useT();
	return (
		<IconButton
			variant="outline"
			icon={RiPlayLine}
			label={t("plan.item.checkIt")}
			tooltip={t("plan.item.reviewBusy")}
			disabled
		/>
	);
}
