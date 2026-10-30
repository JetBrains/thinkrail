import { RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { FileChip } from "@/chat/FileChip";

export default function Truncation() {
	const t = useT();
	const name = "Screenshot 2025-03-14 at 09.41.27 — design review, second pass.png";
	return (
		<div className="flex w-full max-w-[16rem] flex-wrap gap-4">
			<FileChip
				title={name}
				label={name}
				meta=" · 2880×1800"
				trailing={
					<IconButton
						icon={RiCloseLine}
						size="s"
						label={t("chat.promptImages.remove")}
						onClick={() => {}}
					/>
				}
			/>
		</div>
	);
}
