import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { SettingsNotice } from "@/panels/SettingsNotice";

export default function Permission() {
	const t = useT();
	return (
		<SettingsNotice
			variant="info"
			testId="notifications-permission-prompt"
			action={
				<Button variant="outline" size="m" onClick={() => {}}>
					{t("settings.notifications.allowInBrowser")}
				</Button>
			}
		>
			{t("settings.notifications.notGranted")}
		</SettingsNotice>
	);
}
