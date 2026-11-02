import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsRadioCards } from "@/panels/SettingsRadioCards";

export default function NonPreset() {
	const t = useT();
	const [choice, setChoice] = useState<string>("5");
	return (
		<div className="w-full">
			<SettingsRadioCards
				name="settle-idle-days-custom"
				label={t("settings.workspaces.title")}
				choices={[
					{
						id: "3",
						label: t("settings.workspaces.idle.days", { count: 3 }),
						description: t("settings.workspaces.idle.threeDays"),
						testId: "settle-idle-3",
					},
					{
						id: "7",
						label: t("settings.workspaces.idle.days", { count: 7 }),
						hint: t("settings.workspaces.idle.defaultHint"),
						description: t("settings.workspaces.idle.sevenDays"),
						testId: "settle-idle-7",
					},
					{
						id: "14",
						label: t("settings.workspaces.idle.days", { count: 14 }),
						description: t("settings.workspaces.idle.fourteenDays"),
						testId: "settle-idle-14",
					},
				]}
				value={choice}
				onSelect={setChoice}
			/>
		</div>
	);
}
