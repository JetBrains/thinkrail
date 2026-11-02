import { RiArrowDownSLine, RiArrowUpSLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { HeaderIconButton } from "@/panels/HeaderIconButton";

export default function CollapseExpand() {
	const t = useT();
	return (
		<div className="flex items-center gap-4">
			<HeaderIconButton
				testid="changes-review-collapse-all"
				label={t("changes.review.collapseAll")}
				onClick={() => {}}
				icon={RiArrowUpSLine}
			/>
			<HeaderIconButton
				testid="changes-review-expand-all"
				label={t("changes.review.expandAll")}
				onClick={() => {}}
				icon={RiArrowDownSLine}
			/>
		</div>
	);
}
