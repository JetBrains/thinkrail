import { RiAddLine, RiArrowDownSLine, RiArrowRightLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";

export default function Icons() {
	const t = useT();
	return (
		<div className="flex flex-wrap items-center gap-8">
			<Button variant="outline" iconLeft={RiAddLine}>
				{t("common.add")}
			</Button>
			<Button variant="outline" iconRight={RiArrowRightLine}>
				{t("common.next")}
			</Button>
			<Button variant="outline" iconLeft={RiAddLine} iconRight={RiArrowDownSLine}>
				{t("common.add")}
			</Button>
		</div>
	);
}
