import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useId, useState } from "react";
import {
	type NotificationChannel,
	type NotificationPermissionState,
	selectNotificationChannel,
} from "@/notifications";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SettingsNotice } from "./SettingsNotice";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";

function HowToEnableInstructions() {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const stepsId = useId();

	return (
		<div className="flex flex-col">
			<button
				type="button"
				aria-expanded={expanded}
				aria-controls={stepsId}
				onClick={() => setExpanded((v) => !v)}
				className="flex items-center gap-4 tr-text-metadata text-text-muted transition-colors hover:text-text-default"
			>
				{expanded ? (
					<RiArrowDownSLine className="size-14" />
				) : (
					<RiArrowRightSLine className="size-14" />
				)}
				{t("settings.notifications.howToEnable")}
			</button>
			{expanded ? (
				<ol
					id={stepsId}
					className="mt-8 ml-24 list-decimal space-y-4 tr-text-metadata text-text-muted"
				>
					<li>{t("settings.notifications.step.lock")}</li>
					<li>{t("settings.notifications.step.find")}</li>
					<li>{t("settings.notifications.step.allow")}</li>
					<li>{t("settings.notifications.step.refresh")}</li>
				</ol>
			) : null}
		</div>
	);
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
		getTransport()
			.request("settings.update", { config: { notificationsEnabled } })
			.catch(() => toast.error(t("settings.notifications.changeFailed")));
		if (notificationsEnabled && permission === "default") {
			requestPermission();
		}
	};

	const browserPermission = enabled && channelKind === "browser" ? permission : "granted";

	return (
		<div data-testid="settings-notifications" className={SETTINGS_ROWS_CONTAINER}>
			<SettingsRow
				label={t("settings.notifications.enable")}
				description={
					channelKind === "os"
						? t("settings.notifications.osDescription")
						: t("settings.notifications.browserDescription")
				}
				control={
					<SettingsSwitch
						checked={enabled}
						label={t("settings.notifications.enable")}
						testId="notifications-toggle"
						onChange={setEnabled}
					/>
				}
			/>

			{browserPermission === "default" ? (
				<div className="border-border-muted border-b py-12">
					<SettingsNotice
						variant="info"
						testId="notifications-permission-prompt"
						action={
							<Button
								variant="outline"
								size="sm"
								data-testid="notifications-allow"
								onClick={requestPermission}
							>
								{t("settings.notifications.allowInBrowser")}
							</Button>
						}
					>
						{t("settings.notifications.notGranted")}
					</SettingsNotice>
				</div>
			) : browserPermission === "denied" || browserPermission === "unsupported" ? (
				<div className="border-border-muted border-b py-12">
					<SettingsNotice
						variant="warning"
						testId="notifications-permission-warning"
						action={browserPermission === "denied" ? <HowToEnableInstructions /> : null}
					>
						{browserPermission === "unsupported"
							? t("settings.notifications.unsupported")
							: t("settings.notifications.blocked")}
					</SettingsNotice>
				</div>
			) : null}
		</div>
	);
}
