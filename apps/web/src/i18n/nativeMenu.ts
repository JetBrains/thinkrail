import type { NativeMenuBridge } from "@thinkrail/contracts";
import { DESKTOP_MENU_KEYS } from "@thinkrail/locales";
import { t } from "@thinkrail/locales/react";

function menuBridge(): NativeMenuBridge | undefined {
	const bridge: unknown = Reflect.get(globalThis, "__THINKRAIL_NATIVE_MENU__");
	return typeof bridge === "object" &&
		bridge !== null &&
		typeof Reflect.get(bridge, "setLabels") === "function"
		? (bridge as NativeMenuBridge)
		: undefined;
}

export function pushNativeMenuLabels(): void {
	menuBridge()?.setLabels(Object.fromEntries(DESKTOP_MENU_KEYS.map((key) => [key, t(key)])));
}
