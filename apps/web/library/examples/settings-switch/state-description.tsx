import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsRow } from "@/panels/SettingsRow";
import { SettingsSwitch } from "@/panels/SettingsSwitch";

export default function StateDescription() {
	const t = useT();
	const [enabled, setEnabled] = useState(true);
	return (
		<div className="w-full max-w-[28rem]">
			<SettingsRow
				noBorder
				label={t("settings.subagents.allow")}
				description={
					enabled
						? t("settings.subagents.allowOnDescription")
						: t("settings.subagents.allowOffDescription")
				}
				control={
					<SettingsSwitch
						checked={enabled}
						label={t("settings.subagents.allowGlobally")}
						testId="subagents-global-toggle"
						onChange={setEnabled}
					/>
				}
			/>
		</div>
	);
}
