import { RiRefreshLine, RiSendPlaneLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useState } from "react";

export default function Loading() {
	const t = useT();
	const [sending, setSending] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const run = (set: (value: boolean) => void) => {
		set(true);
		setTimeout(() => set(false), 1500);
	};
	return (
		<div className="flex items-center gap-8">
			<IconButton
				variant="primary"
				icon={RiSendPlaneLine}
				label={t("common.confirm")}
				loading={sending}
				onClick={() => run(setSending)}
			/>
			<IconButton
				icon={RiRefreshLine}
				label={t("panels.branchPicker.refresh")}
				loading={refreshing}
				spinIcon
				onClick={() => run(setRefreshing)}
			/>
		</div>
	);
}
