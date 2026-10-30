import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { toast } from "@/store";

export default function MessageOnly() {
	const t = useT();
	return (
		<Button
			variant="outline"
			size="m"
			onClick={() => toast.info(t("panels.diffSurface.staleView"))}
		>
			{t("plan.item.checkIt")}
		</Button>
	);
}
