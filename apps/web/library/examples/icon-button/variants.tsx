import { RiAddLine, RiDeleteBinLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";

export default function Variants() {
	const t = useT();
	return (
		<div className="flex items-center gap-8">
			<IconButton variant="primary" icon={RiAddLine} label={t("common.add")} />
			<IconButton variant="soft-primary" icon={RiAddLine} label={t("common.add")} />
			<IconButton variant="outline" icon={RiAddLine} label={t("common.add")} />
			<IconButton variant="ghost" icon={RiAddLine} label={t("common.add")} />
			<IconButton variant="destructive" icon={RiDeleteBinLine} label={t("common.delete")} />
		</div>
	);
}
