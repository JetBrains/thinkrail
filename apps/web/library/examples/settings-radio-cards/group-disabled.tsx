import { useT } from "@thinkrail/locales/react";
import { SettingsRadioCards } from "@/panels/SettingsRadioCards";

export default function GroupDisabled() {
	const t = useT();
	const supported = false;
	return (
		<div className="w-full">
			<SettingsRadioCards
				name="settle-idle-days-unsupported"
				label={t("settings.workspaces.title")}
				choices={[
					{
						id: "7",
						label: t("settings.workspaces.idle.days", { count: 7 }),
						hint: t("settings.workspaces.idle.defaultHint"),
						description: t("settings.workspaces.idle.sevenDays"),
						testId: "settle-idle-7",
					},
					{
						id: "never",
						label: t("settings.workspaces.idle.neverLabel"),
						description: t("settings.workspaces.idle.never"),
						testId: "settle-idle-never",
					},
				]}
				value="7"
				disabled={!supported}
				onSelect={() => {}}
			/>
		</div>
	);
}
