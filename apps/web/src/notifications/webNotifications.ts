/** Permission state, with an extra `unsupported` for environments without the Notifications API. */
export type NotificationPermissionState = "default" | "granted" | "denied" | "unsupported";

export function notificationsSupported(): boolean {
	return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermissionState {
	if (!notificationsSupported()) return "unsupported";
	return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
	if (!notificationsSupported()) return "unsupported";
	try {
		return await Notification.requestPermission();
	} catch {
		return "denied";
	}
}

/** True only while this browser window holds focus — the one suppression signal the client owns. */
export function isWindowFocused(): boolean {
	return typeof document !== "undefined" && document.hasFocus();
}

export interface ShowNotificationInput {
	title: string;
	body: string;
	tag: string;
	onClick: () => void;
}

/**
 * Raise one OS notification via the page Notifications API. A no-op unless permission is granted;
 * clicking focuses this window and runs the click handler. No Service Worker: a closed app has no
 * live client and therefore nothing to deliver.
 */
export function showBrowserNotification(input: ShowNotificationInput): void {
	if (notificationPermission() !== "granted") return;
	const notification = new Notification(input.title, { body: input.body, tag: input.tag });
	notification.onclick = (event) => {
		event.preventDefault();
		window.focus();
		input.onClick();
		notification.close();
	};
}
