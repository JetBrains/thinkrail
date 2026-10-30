import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";
import { SettingsRow } from "@/panels/SettingsRow";

type Growth = "compact" | "roomy" | "half-chat";

export default function InSettingsRow() {
	const t = useT();
	const [growth, setGrowth] = useState<Growth>("roomy");
	return (
		<div className="w-full">
			<SettingsRow
				noBorder
				label={t("settings.chat.composerSize")}
				description={t("settings.chat.composerSizeDescription")}
				control={
					<SegmentedControl
						name="composer-growth-limit"
						label={t("settings.chat.composerSize")}
						options={[
							{ id: "compact", label: t("settings.chat.growth.compact") },
							{ id: "roomy", label: t("settings.chat.growth.roomy") },
							{ id: "half-chat", label: t("settings.chat.growth.halfChat") },
						]}
						value={growth}
						onSelect={(next) => {
							if (next === growth) return;
							setGrowth(next);
						}}
						testId="composer-growth-control"
					/>
				}
			/>
		</div>
	);
}
