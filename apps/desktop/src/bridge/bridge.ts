/**
 * Tauri v2 replacement for the Electrobun preload bridge (`../preload.ts`).
 *
 * Installs the exact same frozen, non-enumerable globals the web client's
 * shape-guards look for (`__THINKRAIL_NATIVE_*__`,
 * `__THINKRAIL_STABLE_PREFERENCES__`, `__THINKRAIL_NATIVE_WINDOW_CONTROLS__`,
 * `__THINKRAIL_NATIVE_MENU__`), but transports requests over
 * `@tauri-apps/api` `invoke` and subscribes to backend pushes with `listen`
 * instead of the Electrobun `Electroview.defineRPC` channel.
 *
 * Event/command names mirror the Electrobun RPC message names
 * (`updateStateChanged`, `windowChromeChanged`, `windowStateChanged`,
 * `windowFocusChanged`, `quitHintChanged`, `nativeCommand`, `openFile`) so a
 * future shared handler can serve both shells.
 *
 * The seed globals (`__THINKRAIL_INITIAL_WINDOW_CHROME__`,
 * `__THINKRAIL_INITIAL_DESKTOP_PREFERENCES__`) are consumed and removed, just
 * like `takePreloadGlobal` in the Electrobun preload. They are normally
 * injected ahead of this module by `tauriInitializationScript()` from
 * `./injection.ts` (registered as a Tauri initialization script, which runs
 * before page scripts with `withGlobalTauri` enabled).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
	NativeCommand,
	NativeDeepLinkBridge,
	NativeMenuBridge,
	NativeNotificationBridge,
	NativeNotificationInput,
	NativeOpenFileRequest,
	NativeQuitHint,
	NativeShortcutsBridge,
	NativeUpdateBridge,
	NativeUpdateState,
	NativeWindowControlsBridge,
	NativeWindowState,
} from "@thinkrail/contracts";
import { installExternalLinkRouting } from "../externalNavigation";
import {
	createPageZoomBridge,
	handlePageZoomShortcut,
	installPageZoomGestures,
	type PageZoomAction,
	type PageZoomGesture,
} from "../pageZoom";
import {
	INITIAL_DESKTOP_PREFERENCES_GLOBAL,
	isDesktopPreferenceKey,
	isDesktopPreferenceValue,
	STABLE_PREFERENCES_GLOBAL,
} from "../preferenceAdapter";
import { takePreloadGlobal } from "../preloadGlobals";
import { createShortcutsBridge } from "../shortcutsBridge";
import { installTitleBarDoubleClick } from "../titleBarDoubleClick";
import {
	createWindowChromeStyleWriter,
	INITIAL_WINDOW_CHROME_GLOBAL,
	NATIVE_WINDOW_CONTROLS_GLOBAL,
	readWindowChromeFlag,
} from "../windowChrome";

/** Values normally injected ahead of this module by the init script. */
export interface TauriBridgeSeed {
	windowChrome: unknown;
	preferences: unknown;
}

export interface TauriBridgeHandle {
	dispose(): void;
}

interface DesktopPreferenceAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

type Globals = typeof globalThis & Record<string, unknown>;

function installGlobal(name: string, value: object): void {
	Object.defineProperty(globalThis as Globals, name, {
		value,
		writable: false,
		configurable: false,
		enumerable: false,
	});
}

/** Fire-and-forget backend command; failures are swallowed like Electrobun sends. */
function send(command: string, args?: Record<string, unknown>): void {
	void invoke(command, args).catch(() => undefined);
}

/**
 * Install every frozen non-enumerable native bridge global over Tauri IPC.
 * Reads (and consumes) the injected seed globals unless explicit overrides
 * are provided, so tests and alternative hosts can drive it directly.
 */
export function installTauriBridge(seed?: TauriBridgeSeed): TauriBridgeHandle {
	const disposers: Array<() => void> = [];
	const pendingUnlistens: Array<Promise<UnlistenFn>> = [];
	const on = <T>(event: string, handler: (payload: T) => void): void => {
		pendingUnlistens.push(
			listen<T>(event, (envelope) => handler(envelope.payload)).catch(() => () => undefined),
		);
	};
	const later = (task: () => void): void => {
		disposers.push(task);
	};

	const initialWindowChrome = seed?.windowChrome ?? takePreloadGlobal(INITIAL_WINDOW_CHROME_GLOBAL);
	const windowChromeStyle = createWindowChromeStyleWriter(() => document.documentElement ?? null);
	const flushWindowChrome = (): void => windowChromeStyle.flush();
	document.addEventListener("DOMContentLoaded", flushWindowChrome, { once: true });
	later(() => document.removeEventListener("DOMContentLoaded", flushWindowChrome));
	windowChromeStyle.update(initialWindowChrome);

	const updateListeners = new Set<(state: NativeUpdateState) => void>();
	const windowStateListeners = new Set<(state: NativeWindowState) => void>();
	const deepLinkListeners = new Set<(request: NativeOpenFileRequest) => void>();
	const pendingDeepLinks: NativeOpenFileRequest[] = [];
	let nativeWindowFocused = document.hasFocus();
	const markFocused = (): void => {
		nativeWindowFocused = true;
	};
	window.addEventListener("focus", markFocused);
	later(() => window.removeEventListener("focus", markFocused));

	const shortcuts = createShortcutsBridge(async () => {
		await invoke("quit_app");
	});
	on<NativeUpdateState>("updateStateChanged", (state) => {
		for (const listener of updateListeners) listener(state);
	});
	on<NativeWindowState>("windowStateChanged", (state) => {
		for (const listener of windowStateListeners) listener(state);
	});
	on<NativeOpenFileRequest>("openFile", (request) => {
		if (deepLinkListeners.size === 0) {
			pendingDeepLinks.push(request);
			return;
		}
		for (const listener of deepLinkListeners) listener(request);
	});
	on<unknown>("windowChromeChanged", (geometry) => windowChromeStyle.update(geometry));
	on<{ focused: boolean }>("windowFocusChanged", ({ focused }) => {
		nativeWindowFocused = focused;
	});
	on<{ hint: NativeQuitHint }>("quitHintChanged", ({ hint }) => shortcuts.emitQuitHint(hint));
	on<{ command: NativeCommand }>("nativeCommand", ({ command }) => shortcuts.emitCommand(command));

	const updateBridge: NativeUpdateBridge = Object.freeze({
		getState: () => invoke<NativeUpdateState>("get_update_state"),
		checkForUpdates: () => invoke("check_for_updates").then(() => undefined),
		downloadUpdate: () => invoke("download_update").then(() => undefined),
		restartToUpdate: () => invoke("restart_to_update").then(() => undefined),
		dismissInstallResult: () => invoke("dismiss_install_result").then(() => undefined),
		subscribe: (listener: (state: NativeUpdateState) => void) => {
			updateListeners.add(listener);
			return () => updateListeners.delete(listener);
		},
	});
	installGlobal("__THINKRAIL_NATIVE_SHORTCUTS__", shortcuts.bridge satisfies NativeShortcutsBridge);
	installGlobal("__THINKRAIL_NATIVE_UPDATES__", updateBridge);

	const notificationBridge: NativeNotificationBridge = Object.freeze({
		show: (input: NativeNotificationInput) => {
			const args: Record<string, unknown> = { title: input.title, body: input.body };
			if (input.subtitle !== undefined) args.subtitle = input.subtitle;
			if (input.silent !== undefined) args.silent = input.silent;
			send("show_notification", args);
		},
		isWindowFocused: () => nativeWindowFocused,
	});
	const deepLinkBridge: NativeDeepLinkBridge = Object.freeze({
		subscribe: (listener: (request: NativeOpenFileRequest) => void) => {
			deepLinkListeners.add(listener);
			const queued = pendingDeepLinks.splice(0);
			for (const request of queued) listener(request);
			return () => deepLinkListeners.delete(listener);
		},
	});
	installGlobal("__THINKRAIL_NATIVE_DEEP_LINKS__", deepLinkBridge);
	installGlobal("__THINKRAIL_NATIVE_NOTIFICATIONS__", notificationBridge);

	const requestPageZoom = (action: PageZoomAction): void => {
		send("page_zoom_requested", { action });
	};
	installGlobal("__THINKRAIL_NATIVE_PAGE_ZOOM__", createPageZoomBridge(requestPageZoom));

	if (readWindowChromeFlag(initialWindowChrome, "windowControls") === true) {
		const windowControlsBridge: NativeWindowControlsBridge = Object.freeze({
			getState: () => invoke<NativeWindowState>("get_window_state"),
			minimize: () => invoke("minimize_window").then(() => undefined),
			toggleMaximize: () => invoke("toggle_maximize_window").then(() => undefined),
			close: () => invoke("close_window").then(() => undefined),
			subscribe: (listener: (state: NativeWindowState) => void) => {
				windowStateListeners.add(listener);
				return () => windowStateListeners.delete(listener);
			},
		});
		installGlobal(NATIVE_WINDOW_CONTROLS_GLOBAL, windowControlsBridge);
	}

	const menuBridge: NativeMenuBridge = Object.freeze({
		setLabels: (labels: Readonly<Record<string, string>>) => {
			send("menu_labels_changed", { labels: { ...labels } });
		},
	});
	installGlobal("__THINKRAIL_NATIVE_MENU__", menuBridge);

	const injectedPreferences =
		seed?.preferences ?? takePreloadGlobal(INITIAL_DESKTOP_PREFERENCES_GLOBAL);
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
			send("preference_write", { key, value });
		},
		removeItem: (key: string) => {
			if (!isDesktopPreferenceKey(key)) return;
			preferences.delete(key);
			send("preference_remove", { key });
		},
	});
	installGlobal(STABLE_PREFERENCES_GLOBAL, preferenceAdapter);

	installTitleBarDoubleClick(window, () => send("title_bar_double_click"));
	installExternalLinkRouting(window);
	const handleZoomShortcut = (event: KeyboardEvent): void => {
		handlePageZoomShortcut(event, navigator.platform, requestPageZoom);
	};
	window.addEventListener("keydown", handleZoomShortcut);
	later(() => window.removeEventListener("keydown", handleZoomShortcut));
	const requestGesture = (gesture: PageZoomGesture): void => {
		if (gesture.phase === "change") {
			send("page_zoom_gesture_requested", { phase: gesture.phase, scale: gesture.scale });
		} else {
			send("page_zoom_gesture_requested", { phase: gesture.phase });
		}
	};
	installPageZoomGestures(window, navigator.platform, requestGesture);

	const sendRoute = (): void => {
		send("route_changed", { hash: window.location.hash });
	};
	const originalReplaceState = history.replaceState.bind(history);
	const patchedReplaceState = (...args: Parameters<History["replaceState"]>): void => {
		originalReplaceState(...args);
		sendRoute();
	};
	const originalPushState = history.pushState.bind(history);
	const patchedPushState = (...args: Parameters<History["pushState"]>): void => {
		originalPushState(...args);
		sendRoute();
	};
	history.replaceState = patchedReplaceState;
	history.pushState = patchedPushState;
	later(() => {
		history.replaceState = originalReplaceState;
		history.pushState = originalPushState;
	});
	window.addEventListener("hashchange", sendRoute);
	window.addEventListener("popstate", sendRoute);
	window.addEventListener("DOMContentLoaded", sendRoute);
	later(() => {
		window.removeEventListener("hashchange", sendRoute);
		window.removeEventListener("popstate", sendRoute);
		window.removeEventListener("DOMContentLoaded", sendRoute);
	});
	queueMicrotask(sendRoute);

	return {
		dispose: () => {
			for (const dispose of disposers.splice(0)) {
				try {
					dispose();
				} catch {
					// Disposal is best-effort; a failing listener must not block the rest.
				}
			}
			for (const pending of pendingUnlistens.splice(0)) {
				void pending.then((unlisten) => unlisten()).catch(() => undefined);
			}
		},
	};
}

/**
 * Alias kept so harnesses written against either name keep working; the
 * install is identical.
 */
export const buildTauriBridgeInvoke = installTauriBridge;
