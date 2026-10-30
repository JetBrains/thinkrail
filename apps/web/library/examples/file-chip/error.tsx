import { RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useState } from "react";
import { FileChip } from "@/chat/FileChip";

export default function ErrorChip() {
	const t = useT();
	const [shown, setShown] = useState(true);
	const name = "holiday-photo-from-the-beach.heic";
	const reason = t("chat.promptImages.unsupported");
	if (!shown) return null;
	return (
		<div className="flex w-full max-w-[20rem] flex-wrap gap-4">
			<FileChip
				tone="error"
				icon={false}
				title={t("chat.promptImages.attachFailedDetail", { name, reason })}
				label={t("chat.promptImages.attachFailed", { name })}
				meta={`— ${reason}`}
				trailing={
					<IconButton
						icon={RiCloseLine}
						size="s"
						label={t("common.dismiss")}
						onClick={() => setShown(false)}
					/>
				}
			/>
		</div>
	);
}
