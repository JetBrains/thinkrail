import type { NotificationChannel } from "./channel";

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

/** The symbol-only ThinkRail mark, the same artwork as the browser-tab favicon and shell logo. */
const NOTIFICATION_ICON = "/favicon.svg";

export interface ShowNotificationInput {
	title: string;
	body: string;
	tag: string;
	onClick: () => void;
}

/**
 * The browser channel: the page Notifications API, folding the subtitle (worktree) into the body since
 * web notifications have no subtitle field, and using the browser permission flow.
 */
export function createWebNotificationChannel(): NotificationChannel {
	return {
		permission: notificationPermission,
		requestPermission: requestNotificationPermission,
		show: (spec, onClick) => {
			const body = spec.subtitle ? `${spec.subtitle} · ${spec.body}` : spec.body;
			showBrowserNotification({ title: spec.title, body, tag: spec.tag, onClick });
		},
	};
}

/**
 * Raise one OS notification via the page Notifications API. A no-op unless permission is granted;
 * clicking focuses this window and runs the click handler. No Service Worker: a closed app has no
 * live client and therefore nothing to deliver. The page-context constructor throws on some mobile
 * browsers (e.g. Android Chrome requires a Service Worker), so a failure is swallowed as unsupported.
 */
export function showBrowserNotification(input: ShowNotificationInput): void {
	if (notificationPermission() !== "granted") return;
	try {
		const notification = new Notification(input.title, {
			body: input.body,
			tag: input.tag,
			icon: NOTIFICATION_ICON,
		});
		notification.onclick = (event) => {
			event.preventDefault();
			window.focus();
			input.onClick();
			notification.close();
		};
	} catch {
		// Unsupported page-context constructor (mobile) — silently drop rather than crash the flush.
	}
}
