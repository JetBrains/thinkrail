import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";
import { SettingsRow } from "@/panels/SettingsRow";

type Growth = "compact" | "roomy" | "half-chat";

export default function Narrow() {
	const t = useT();
	const [growth, setGrowth] = useState<Growth>("roomy");
	return (
		<div className="w-full max-w-[20rem]">
			<SettingsRow
				label={t("settings.chat.composerSize")}
				description={t("settings.chat.composerSizeDescription")}
				control={
					<SegmentedControl
						name="narrow-composer-growth"
						label={t("settings.chat.composerSize")}
						options={[
							{ id: "compact", label: t("settings.chat.growth.compact") },
							{ id: "roomy", label: t("settings.chat.growth.roomy") },
							{ id: "half-chat", label: t("settings.chat.growth.halfChat") },
						]}
						value={growth}
						onSelect={setGrowth}
					/>
				}
			/>
		</div>
	);
}
