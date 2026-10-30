import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsRow } from "@/panels/SettingsRow";
import { SettingsSwitch } from "@/panels/SettingsSwitch";

export default function Basic() {
	const t = useT();
	const [enabled, setEnabled] = useState(true);
	return (
		<div className="w-full max-w-[28rem]">
			<SettingsRow
				noBorder
				label={t("settings.privacy.share")}
				control={
					<SettingsSwitch
						checked={enabled}
						label={t("settings.privacy.share")}
						testId="analytics-toggle"
						onChange={setEnabled}
					/>
				}
			/>
		</div>
	);
}
