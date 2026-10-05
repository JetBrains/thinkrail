import { requestNotificationPermission } from "@/notifications";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SettingsSwitch } from "./SettingsSwitch";

const NOTIFICATIONS_DESCRIPTION =
	"Get an out-of-app notification when a worktree needs you — an agent asks a question, finishes, or fails. Notifications only appear while this window isn't focused, and your browser must grant permission.";

export function NotificationsSettings() {
	const enabled = useAppStore((s) => s.notificationsEnabled);

	const setEnabled = (notificationsEnabled: boolean) => {
		getTransport()
			.request("settings.update", { config: { notificationsEnabled } })
			.catch(() => toast.error("Couldn't change the notification setting"));
		// Turning the toggle on is a user gesture, so request browser permission right here: the feature
		// works immediately instead of waiting for the first out-of-focus attention event.
		if (notificationsEnabled) {
			void requestNotificationPermission().then((result) => {
				if (result === "denied") {
					toast.error(
						"Notifications are blocked for this site. Re-enable them in your browser's site settings.",
						"Notifications blocked",
					);
				}
			});
		}
	};

	return (
		<section data-testid="settings-notifications" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Notifications</h3>
				<p className="text-text-muted tr-text-metadata">{NOTIFICATIONS_DESCRIPTION}</p>
			</div>

			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<span className="tr-title-compact text-text-default">Enable notifications</span>
				<SettingsSwitch
					checked={enabled}
					label="Enable notifications"
					testId="notifications-toggle"
					onChange={setEnabled}
				/>
			</div>
		</section>
	);
}
