import { RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";

export default function Tooltip() {
	const t = useT();
	return (
		<IconButton
			icon={RiCloseLine}
			label={t("common.cancel")}
			tooltip={t("chat.extUi.cancelHint")}
			tooltipSide="right"
			onClick={() => {}}
		/>
	);
}
