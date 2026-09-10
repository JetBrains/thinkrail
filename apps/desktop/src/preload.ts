import type {
	NativeUpdateBridge,
	NativeUpdateState,
	NativeWindowAppearance,
	NativeWindowChromeBridge,
} from "@thinkrail/contracts";
import Electrobun, { Electroview } from "electrobun/view";
import {
	INITIAL_DESKTOP_PREFERENCES_GLOBAL,
	isDesktopPreferenceKey,
	isDesktopPreferenceValue,
	STABLE_PREFERENCES_GLOBAL,
} from "./preferenceAdapter";
import { takePreloadGlobal } from "./preloadGlobals";
import type { DesktopRpc } from "./rpc";
import { NATIVE_WINDOW_CHROME_GLOBAL } from "./windowAppearance";
import { createWindowChromeStyleWriter, INITIAL_WINDOW_CHROME_GLOBAL } from "./windowChrome";

interface DesktopPreferenceAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const chromeStyle = createWindowChromeStyleWriter(() => document.documentElement?.style ?? null);
document.addEventListener("DOMContentLoaded", chromeStyle.flush, { once: true });
const initialChrome = takePreloadGlobal(INITIAL_WINDOW_CHROME_GLOBAL);
chromeStyle.update(initialChrome);

const updateListeners = new Set<(state: NativeUpdateState) => void>();
const rpc = Electroview.defineRPC<DesktopRpc>({
	maxRequestTime: 5000,
	handlers: {
		requests: {},
		messages: {
			windowChromeChanged: chromeStyle.update,
			updateStateChanged: (state) => {
				for (const listener of updateListeners) listener(state);
			},
		},
	},
});
const electroview = new Electrobun.Electroview({ rpc });
if (
	typeof initialChrome === "object" &&
	initialChrome !== null &&
	Reflect.get(initialChrome, "nativeAppearance") === true
) {
	const chromeBridge: NativeWindowChromeBridge = Object.freeze({
		setAppearance: (appearance: NativeWindowAppearance) =>
			rpc.send.windowAppearanceChanged(appearance),
	});
	Object.defineProperty(globalThis, NATIVE_WINDOW_CHROME_GLOBAL, {
		value: chromeBridge,
		writable: false,
		configurable: false,
		enumerable: false,
	});
}
const updateBridge: NativeUpdateBridge = Object.freeze({
	getState: () => rpc.request.getUpdateState(),
	checkForUpdates: () => rpc.request.checkForUpdates(),
	restartToUpdate: () => rpc.request.restartToUpdate(),
	subscribe: (listener: (state: NativeUpdateState) => void) => {
		updateListeners.add(listener);
		return () => updateListeners.delete(listener);
	},
});
Object.defineProperty(globalThis, "__THINKRAIL_NATIVE_UPDATES__", {
	value: updateBridge,
	writable: false,
	configurable: false,
	enumerable: false,
});
const injectedPreferences = takePreloadGlobal(INITIAL_DESKTOP_PREFERENCES_GLOBAL);
const preferences = new Map<string, string>();
if (typeof injectedPreferences === "object" && injectedPreferences !== null) {
	for (const key of Object.keys(injectedPreferences)) {
		const value = Reflect.get(injectedPreferences, key);
		if (isDesktopPreferenceKey(key) && isDesktopPreferenceValue(value)) {
			preferences.set(key, value);
		}
	}
}
const preferenceAdapter: DesktopPreferenceAdapter = Object.freeze({
	getItem: (key: string) => (isDesktopPreferenceKey(key) ? (preferences.get(key) ?? null) : null),
	setItem: (key: string, value: string) => {
		if (!isDesktopPreferenceKey(key) || !isDesktopPreferenceValue(value)) return;
		preferences.set(key, value);
		electroview.rpc?.send.preferenceWrite({ key, value });
	},
	removeItem: (key: string) => {
		if (!isDesktopPreferenceKey(key)) return;
		preferences.delete(key);
		electroview.rpc?.send.preferenceRemove({ key });
	},
});
Object.defineProperty(globalThis, STABLE_PREFERENCES_GLOBAL, {
	value: preferenceAdapter,
	writable: false,
	configurable: false,
	enumerable: false,
});

const sendRoute = () => electroview.rpc?.send.routeChanged({ hash: window.location.hash });
const replaceState = history.replaceState.bind(history);
history.replaceState = (...args: Parameters<History["replaceState"]>) => {
	replaceState(...args);
	sendRoute();
};
const pushState = history.pushState.bind(history);
history.pushState = (...args: Parameters<History["pushState"]>) => {
	pushState(...args);
	sendRoute();
};
window.addEventListener("hashchange", sendRoute);
window.addEventListener("popstate", sendRoute);
window.addEventListener("DOMContentLoaded", sendRoute);
queueMicrotask(sendRoute);
