import { useT } from "@thinkrail/locales/react";
import { SettingsSwitch } from "@/panels/SettingsSwitch";

export default function Disabled() {
	const t = useT();
	return (
		<div className="flex items-center gap-16">
			<SettingsSwitch
				checked={false}
				disabled
				label={t("panels.analytics.shareLabel")}
				testId="analytics-toggle-off"
				onChange={() => {}}
			/>
			<SettingsSwitch
				checked
				disabled
				label={t("panels.analytics.shareLabel")}
				testId="analytics-toggle-on"
				onChange={() => {}}
			/>
		</div>
	);
}
