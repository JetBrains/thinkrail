import { DEFAULT_CONFIG } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Switch } from "@thinkrail/ui/switch";
import { useState } from "react";
import {
	type NotificationChannel,
	type NotificationPermissionState,
	selectNotificationChannel,
} from "@/notifications";
import { SETTINGS_ROWS, SettingsNotice, SettingsPage, SettingsRow } from "@/settingsKit";
import { toast, useAppStore } from "@/store";
import { saveSettings } from "./saveSettings";
import { isConfigDefault } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";

export function NotificationPermissionNotice({
	permission,
	onAllow,
}: {
	permission: NotificationPermissionState;
	onAllow: () => void;
}) {
	const t = useT();
	if (permission === "default") {
		return (
			<div className="py-12">
				<SettingsNotice
					variant="info"
					rowId="notifications-permission"
					testId="notifications-permission-prompt"
					action={
						<Button
							variant="outline"
							size="m"
							tabIndex={0}
							data-testid="notifications-allow"
							onClick={onAllow}
						>
							{t("settings.notifications.allowInBrowser")}
						</Button>
					}
				>
					{t("settings.notifications.notGranted")}
				</SettingsNotice>
			</div>
		);
	}
	if (permission === "unsupported") {
		return (
			<div className="py-12">
				<SettingsNotice variant="warning" testId="notifications-permission-warning">
					{t("settings.notifications.unsupported")}
				</SettingsNotice>
			</div>
		);
	}
	if (permission === "denied") {
		return (
			<div className="py-12">
				<SettingsNotice variant="warning" testId="notifications-permission-warning">
					<p>{t("settings.notifications.blocked")}</p>
					<div data-testid="notifications-how-to-enable" className="mt-8 flex flex-col gap-4">
						<p className="text-text-default tr-text-metadata">
							{t("settings.notifications.howToEnable")}
						</p>
						<ol className="ml-24 list-decimal space-y-4 text-text-muted tr-text-metadata">
							<li>{t("settings.notifications.step.lock")}</li>
							<li>{t("settings.notifications.step.find")}</li>
							<li>{t("settings.notifications.step.allow")}</li>
							<li>{t("settings.notifications.step.refresh")}</li>
						</ol>
					</div>
				</SettingsNotice>
			</div>
		);
	}
	return null;
}

export function NotificationsSettings() {
	const t = useT();
	const enabled = useAppStore((s) => s.notificationsEnabled);
	const [channelKind] = useState<NotificationChannel["kind"]>(
		() => selectNotificationChannel().kind,
	);
	const [permission, setPermission] = useState<NotificationPermissionState>(() =>
		selectNotificationChannel().permission(),
	);

	const requestPermission = () => {
		void selectNotificationChannel()
			.requestPermission()
			.then((result) => {
				setPermission(result);
				if (result === "denied") {
					toast.error(
						t("settings.notifications.blockedToast"),
						t("settings.notifications.blockedToastTitle"),
					);
				}
			});
	};

	const setEnabled = (notificationsEnabled: boolean) => {
		void saveSettings({ notificationsEnabled }, t("settings.notifications.changeFailed"));
		if (notificationsEnabled && permission === "default") {
			requestPermission();
		}
	};

	const browserPermission = enabled && channelKind === "browser" ? permission : "granted";

	return (
		<SettingsPage
			title={t("settings.nav.notifications")}
			description={t("settings.notifications.browserDescription")}
			testId="settings-notifications"
		>
			<div className={SETTINGS_ROWS}>
				<SettingsRow
					{...settingProps(t, SETTING.notifications)}
					description={
						channelKind === "os"
							? t("settings.notifications.osDescription")
							: t("settings.notifications.browserDelivery")
					}
					reset={{
						changed: !isConfigDefault("notificationsEnabled", enabled),
						onReset: () => setEnabled(DEFAULT_CONFIG.notificationsEnabled),
					}}
					control={
						<Switch
							checked={enabled}
							label={t(SETTING.notifications.label)}
							testId="notifications-toggle"
							tabIndex={0}
							onCheckedChange={setEnabled}
						/>
					}
				/>
				<NotificationPermissionNotice permission={browserPermission} onAllow={requestPermission} />
			</div>
		</SettingsPage>
	);
}
