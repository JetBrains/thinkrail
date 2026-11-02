import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsRow } from "@/panels/SettingsRow";
import { SettingsSwitch } from "@/panels/SettingsSwitch";

export default function Description() {
	const t = useT();
	const [enabled, setEnabled] = useState(false);
	return (
		<div className="w-full max-w-[28rem]">
			<SettingsRow
				noBorder
				label={t("settings.notifications.enable")}
				description={t("settings.notifications.osDescription")}
				control={
					<SettingsSwitch
						checked={enabled}
						label={t("settings.notifications.enable")}
						testId="notifications-toggle"
						onChange={setEnabled}
					/>
				}
			/>
		</div>
	);
}
