import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";

export default function DisabledReason() {
	const t = useT();
	return (
		<Button size="m" disabled tooltip={t("plan.item.reviewBusy")}>
			{t("plan.item.checkIt")}
		</Button>
	);
}
