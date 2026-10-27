import { RiCloseLine, RiFileCopyLine, RiPencilLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";

export default function Basic() {
	const t = useT();
	return (
		<div className="flex items-center gap-4">
			<IconButton icon={RiPencilLine} label={t("common.edit")} onClick={() => {}} />
			<IconButton icon={RiFileCopyLine} label={t("common.copy")} onClick={() => {}} />
			<IconButton icon={RiCloseLine} label={t("common.close")} onClick={() => {}} />
		</div>
	);
}
