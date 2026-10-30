import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { SettingsNotice } from "@/panels/SettingsNotice";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "@/panels/SettingsRow";
import { SettingsSwitch } from "@/panels/SettingsSwitch";

export default function RowsContainer() {
	const t = useT();
	const [enabled, setEnabled] = useState(true);
	return (
		<div className="w-full max-w-[32rem]">
			<div data-testid="settings-notifications" className={SETTINGS_ROWS_CONTAINER}>
				<SettingsRow
					label={t("settings.notifications.enable")}
					description={t("settings.notifications.browserDescription")}
					control={
						<SettingsSwitch
							checked={enabled}
							label={t("settings.notifications.enable")}
							testId="notifications-toggle"
							onChange={setEnabled}
						/>
					}
				/>
				{enabled ? (
					<div className="py-12">
						<SettingsNotice
							variant="info"
							action={
								<Button variant="outline" size="m" onClick={() => {}}>
									{t("settings.notifications.allowInBrowser")}
								</Button>
							}
						>
							{t("settings.notifications.notGranted")}
						</SettingsNotice>
					</div>
				) : null}
			</div>
		</div>
	);
}
