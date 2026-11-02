import { useT } from "@thinkrail/locales/react";
import { SettingsNotice } from "@/panels/SettingsNotice";

export default function Variants() {
	const t = useT();
	return (
		<div className="flex w-full flex-col gap-4">
			<SettingsNotice variant="neutral">{t("settings.templates.projectEmpty")}</SettingsNotice>
			<SettingsNotice variant="info">{t("settings.notifications.notGranted")}</SettingsNotice>
			<SettingsNotice variant="success">{t("settings.github.connected")}</SettingsNotice>
			<SettingsNotice variant="warning">{t("settings.notifications.blocked")}</SettingsNotice>
			<SettingsNotice variant="error">
				{t("settings.appearance.custom.error.unreadable")}
			</SettingsNotice>
		</div>
	);
}
