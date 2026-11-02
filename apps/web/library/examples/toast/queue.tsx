import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { toast } from "@/store";

export default function Queue() {
	const t = useT();
	const raise = () => {
		toast.info(t("plan.checkAll.runningMessage"), t("plan.checkAll.runningTitle"));
		toast.success(t("plan.review.startedMessage"), t("plan.review.startedTitle"));
		toast.error(t("plan.copyFailed.message"), t("plan.copyFailed.title"));
	};
	return (
		<Button variant="outline" size="m" onClick={raise}>
			{t("plan.item.checkIt")}
		</Button>
	);
}
