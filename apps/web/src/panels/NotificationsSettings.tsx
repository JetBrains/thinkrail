import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
import { useState } from "react";
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

	return (
		<div className="flex flex-col">
			<button
				type="button"
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
			{expanded && (
				<ol className="ml-24 mt-8 list-decimal space-y-4 tr-text-metadata text-text-muted">
					<li>Click the lock or info icon in your browser's address bar</li>
					<li>Find "Notifications" in the site permissions</li>
					<li>Change the setting from "Block" to "Allow"</li>
					<li>Refresh this page</li>
				</ol>
			)}
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
		// Request permission when enabling notifications (if not already granted)
		if (notificationsEnabled && permission === "default") {
			requestPermission();
		}
	};

	// Determine if we need to show a permission warning
	const showPermissionWarning =
		enabled &&
		channelKind === "browser" &&
		(permission === "denied" || permission === "unsupported");

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

			{/* Permission warning - shown only when blocked/denied */}
			{showPermissionWarning && (
				<div className="border-border-muted border-b py-12">
					<SettingsNotice
						variant="warning"
						testId="notifications-permission-warning"
						action={<HowToEnableInstructions />}
					>
						{permission === "unsupported"
							? "This browser doesn't support notifications."
							: "Notifications are blocked by your browser."}
					</SettingsNotice>
				</div>
			)}
		</div>
	);
}
