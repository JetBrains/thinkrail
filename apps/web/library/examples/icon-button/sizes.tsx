import { RiAddLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";

export default function Sizes() {
	const t = useT();
	return (
		<div className="flex items-center gap-8">
			<IconButton variant="outline" size="s" icon={RiAddLine} label={t("common.add")} />
			<IconButton variant="outline" size="m" icon={RiAddLine} label={t("common.add")} />
			<IconButton variant="outline" size="l" icon={RiAddLine} label={t("common.add")} />
		</div>
	);
}
