import { RiAddLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";

export default function Sizes() {
	const t = useT();
	return (
		<div className="flex flex-wrap items-center gap-8">
			<Button variant="outline" size="s" iconLeft={RiAddLine}>
				{t("common.add")}
			</Button>
			<Button variant="outline" size="m" iconLeft={RiAddLine}>
				{t("common.add")}
			</Button>
			<Button variant="outline" size="l" iconLeft={RiAddLine}>
				{t("common.add")}
			</Button>
		</div>
	);
}
