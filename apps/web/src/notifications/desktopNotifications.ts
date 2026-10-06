import type { NativeNotificationBridge } from "@thinkrail/contracts";
import type { NotificationChannel } from "./channel";

const NATIVE_NOTIFICATIONS_GLOBAL = "__THINKRAIL_NATIVE_NOTIFICATIONS__";

/** Shape-guard the optional native bridge the desktop preload freezes onto the global. */
export function getNativeNotificationBridge(value: unknown): NativeNotificationBridge | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	try {
		return typeof Reflect.get(value, "show") === "function"
			? (value as NativeNotificationBridge)
			: null;
	} catch {
		return null;
	}
}

export function readNativeNotificationBridge(): NativeNotificationBridge | null {
	return getNativeNotificationBridge(Reflect.get(globalThis, NATIVE_NOTIFICATIONS_GLOBAL));
}

/**
 * The desktop channel: the native OS notification center via the Electrobun bridge. It uses the
 * `subtitle` (worktree) the web channel folds away, and the OS owns permission, so there is no browser
 * permission flow and no in-app preface. Electrobun click callbacks are not landed yet, so clicks are
 * ignored for now.
 */
export function createDesktopNotificationChannel(
	bridge: NativeNotificationBridge,
): NotificationChannel {
	return {
		kind: "os",
		permission: () => "granted",
		requestPermission: async () => "granted",
		show: (spec) => {
			bridge.show({
				title: spec.title,
				...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
				body: spec.body,
				silent: false,
			});
		},
	};
}
