import { useT } from "@thinkrail/locales/react";
import { LoadingRegion } from "@thinkrail/ui/skeleton";

export default function RestoringTab() {
	const t = useT();
	return (
		<div className="h-160 w-full">
			<LoadingRegion
				rows={12}
				label={t("shell.workbench.restoring.chat")}
				className="h-full overflow-hidden p-16"
			/>
		</div>
	);
}
