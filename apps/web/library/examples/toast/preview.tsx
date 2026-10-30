import { RiFileCopyLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { toast } from "@/store";

export default function Preview() {
	const t = useT();
	return (
		<Button
			variant="outline"
			size="m"
			iconLeft={RiFileCopyLine}
			onClick={() => toast.success(t("plan.copied.message"), t("plan.copied.title"))}
		>
			{t("common.copy")}
		</Button>
	);
}
