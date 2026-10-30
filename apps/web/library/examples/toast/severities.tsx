import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { toast } from "@/store";

export default function Severities() {
	const t = useT();
	return (
		<div className="flex flex-wrap gap-8">
			<Button
				variant="outline"
				size="m"
				onClick={() =>
					toast.info(t("plan.checkAll.runningMessage"), t("plan.checkAll.runningTitle"))
				}
			>
				info
			</Button>
			<Button
				variant="outline"
				size="m"
				onClick={() =>
					toast.success(t("plan.review.startedMessage"), t("plan.review.startedTitle"))
				}
			>
				success
			</Button>
			<Button
				variant="outline"
				size="m"
				onClick={() =>
					toast.warning(t("updates.native.disabled.detail"), t("updates.native.disabled.title"))
				}
			>
				warning
			</Button>
			<Button
				variant="outline"
				size="m"
				onClick={() => toast.error(t("plan.copyFailed.message"), t("plan.copyFailed.title"))}
			>
				error
			</Button>
		</div>
	);
}
