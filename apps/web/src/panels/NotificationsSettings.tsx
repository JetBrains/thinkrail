import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
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
				How to enable
			</button>
			{expanded ? (
				<ol
					id={stepsId}
					className="mt-8 ml-24 list-decimal space-y-4 tr-text-metadata text-text-muted"
				>
					<li>Click the lock or info icon in your browser's address bar</li>
					<li>Find "Notifications" in the site permissions</li>
					<li>Change the setting from "Block" to "Allow"</li>
					<li>Refresh this page</li>
				</ol>
			) : null}
		</div>
	);
}

export function NotificationsSettings() {
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
						"Notifications are blocked. Re-enable in browser site settings.",
						"Notifications blocked",
					);
				}
			});
	};

	const setEnabled = (notificationsEnabled: boolean) => {
		getTransport()
			.request("settings.update", { config: { notificationsEnabled } })
			.catch(() => toast.error("Couldn't change the notification setting"));
		if (notificationsEnabled && permission === "default") {
			requestPermission();
		}
	};

	const browserPermission = enabled && channelKind === "browser" ? permission : "granted";

	return (
		<div data-testid="settings-notifications" className={SETTINGS_ROWS_CONTAINER}>
			<SettingsRow
				label="Enable notifications"
				description={
					channelKind === "os"
						? "Delivered by your operating system."
						: "Get notified when a worktree needs your attention."
				}
				control={
					<SettingsSwitch
						checked={enabled}
						label="Enable notifications"
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
								Allow in browser
							</Button>
						}
					>
						Your browser hasn't granted permission yet.
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
							? "This browser doesn't support notifications."
							: "Notifications are blocked by your browser."}
					</SettingsNotice>
				</div>
			) : null}
		</div>
	);
}
