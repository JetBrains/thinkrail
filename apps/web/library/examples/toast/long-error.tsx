import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { toast } from "@/store";

const DETAIL =
	"git push failed: remote rejected refs/heads/feature/a-very-long-branch-name-without-any-breaks-at-all (pre-receive hook declined)";

export default function LongError() {
	const t = useT();
	return (
		<Button
			variant="outline"
			size="m"
			onClick={() => toast.error(DETAIL, t("plan.review.startFailed"))}
		>
			{t("plan.review.startFailed")}
		</Button>
	);
}
