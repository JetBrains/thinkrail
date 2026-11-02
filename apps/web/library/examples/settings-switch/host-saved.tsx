import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsRow } from "@/panels/SettingsRow";
import { SettingsSwitch } from "@/panels/SettingsSwitch";

export default function HostSaved() {
	const t = useT();
	// `saved` stands in for the host's saved value.
	const [saved, setSaved] = useState(false);
	const update = (next: boolean) => {
		setTimeout(() => setSaved(next), 600);
	};
	return (
		<div className="w-full max-w-[28rem]">
			<SettingsRow
				noBorder
				label={t("settings.lineWidth.fitToPane")}
				description={t("settings.lineWidth.fitToPaneDescription")}
				control={
					<SettingsSwitch
						checked={saved}
						label={t("settings.lineWidth.chat.boundedLabel")}
						testId="chat-line-width-bounded"
						onChange={update}
					/>
				}
			/>
		</div>
	);
}
