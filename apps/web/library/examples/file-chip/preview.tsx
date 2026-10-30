import { RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { FileChip } from "@/chat/FileChip";

export default function Preview() {
	const t = useT();
	return (
		<FileChip
			title="screenshot.png"
			label="screenshot.png"
			meta=" · 1280×720"
			trailing={
				<IconButton
					icon={RiCloseLine}
					size="s"
					label={t("chat.promptImages.remove")}
					onClick={() => {}}
				/>
			}
		/>
	);
}
