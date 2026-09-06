import Electrobun, { Electroview } from "electrobun/view";
import {
	INITIAL_DESKTOP_PREFERENCES_GLOBAL,
	isDesktopPreferenceKey,
	isDesktopPreferenceValue,
	STABLE_PREFERENCES_GLOBAL,
} from "./preferenceAdapter";
import {
	createPreloadWindowChrome,
	INITIAL_WINDOW_CHROME_PLATFORM_GLOBAL,
	readPreloadWindowChromePlatform,
	WINDOW_CHROME_GLOBAL,
} from "./preloadWindowChrome";
import type { DesktopRpc } from "./rpc";

interface DesktopPreferenceAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const globals = globalThis as typeof globalThis & Record<string, unknown>;
const platform = readPreloadWindowChromePlatform(
	Reflect.get(globals, INITIAL_WINDOW_CHROME_PLATFORM_GLOBAL),
);
if (!platform) throw new Error("desktop window chrome platform is missing");
Reflect.deleteProperty(globals, INITIAL_WINDOW_CHROME_PLATFORM_GLOBAL);
let applyWindowChromeSnapshot = (_payload: unknown) => false;
const rpc = Electroview.defineRPC<DesktopRpc>({
	maxRequestTime: 5000,
	handlers: {
		requests: {},
		messages: {
			windowChromeState: (payload) => {
				applyWindowChromeSnapshot(payload);
			},
		},
	},
});
const electroview = new Electrobun.Electroview({ rpc });
const windowChrome = createPreloadWindowChrome({
	platform,
	dispatch: (command) => {
		switch (command.kind) {
			case "minimize":
				electroview.rpc?.send.windowChromeMinimize({});
				break;
			case "toggle-maximize":
				electroview.rpc?.send.windowChromeToggleMaximize({});
				break;
			case "request-close":
				electroview.rpc?.send.windowChromeRequestClose({});
				break;
			case "start-resize":
				electroview.rpc?.send.windowChromeStartResize({ edge: command.edge });
				break;
		}
	},
});
applyWindowChromeSnapshot = windowChrome.applySnapshot;
Object.defineProperty(globals, WINDOW_CHROME_GLOBAL, {
	value: windowChrome.adapter,
	writable: false,
	configurable: false,
	enumerable: false,
});
const injectedPreferences = Reflect.get(globals, INITIAL_DESKTOP_PREFERENCES_GLOBAL);
const preferences = new Map<string, string>();
if (typeof injectedPreferences === "object" && injectedPreferences !== null) {
	for (const key of Object.keys(injectedPreferences)) {
		const value = Reflect.get(injectedPreferences, key);
		if (isDesktopPreferenceKey(key) && isDesktopPreferenceValue(value)) {
			preferences.set(key, value);
		}
	}
}
Reflect.deleteProperty(globals, INITIAL_DESKTOP_PREFERENCES_GLOBAL);
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
Object.defineProperty(globals, STABLE_PREFERENCES_GLOBAL, {
	value: preferenceAdapter,
	writable: false,
	configurable: false,
	enumerable: false,
});

const sendRoute = () => electroview.rpc?.send.routeChanged({ hash: window.location.hash });
const sendWindowChromeReady = () => electroview.rpc?.send.windowChromeReady({ platform });
const sendWindowChromeShellReady = () => {
	const selector = `[data-native-window-platform="${platform}"]`;
	if (document.querySelector(selector)) {
		electroview.rpc?.send.windowChromeShellReady({ platform });
		return;
	}
	const observer = new MutationObserver(() => {
		if (!document.querySelector(selector)) return;
		observer.disconnect();
		electroview.rpc?.send.windowChromeShellReady({ platform });
	});
	observer.observe(document.documentElement, { childList: true, subtree: true });
};
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
window.addEventListener("DOMContentLoaded", () => {
	sendRoute();
	sendWindowChromeReady();
	sendWindowChromeShellReady();
});
queueMicrotask(sendRoute);
