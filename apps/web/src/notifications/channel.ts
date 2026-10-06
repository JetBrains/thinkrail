import {
	createDesktopNotificationChannel,
	readNativeNotificationBridge,
} from "./desktopNotifications";
import type { NotificationSpec } from "./formatNotification";
import { createWebNotificationChannel, type NotificationPermissionState } from "./webNotifications";

/**
 * A notification sink. The browser and desktop channels implement the same surface; the manager picks
 * one by capability, and suppression/format/settings stay channel-agnostic above it.
 */
export interface NotificationChannel {
	permission: () => NotificationPermissionState;
	requestPermission: () => Promise<NotificationPermissionState>;
	show: (spec: NotificationSpec, onClick: () => void) => void;
}

/** The native OS channel when the desktop bridge is present, the browser channel otherwise. */
export function selectNotificationChannel(): NotificationChannel {
	const bridge = readNativeNotificationBridge();
	return bridge ? createDesktopNotificationChannel(bridge) : createWebNotificationChannel();
}
