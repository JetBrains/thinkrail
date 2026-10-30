import { useT } from "@thinkrail/locales/react";
import { FileChip } from "@/chat/FileChip";

export default function Pending() {
	const t = useT();
	return (
		<div className="flex flex-wrap gap-4">
			<FileChip
				label={
					<span className="text-text-muted">{t("chat.promptImages.attaching", { count: 1 })}</span>
				}
			/>
			<FileChip
				label={
					<span className="text-text-muted">{t("chat.promptImages.attaching", { count: 3 })}</span>
				}
			/>
		</div>
	);
}
