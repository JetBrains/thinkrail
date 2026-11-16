// Tauri desktop bridge. The Rust shell (`src-tauri/src/bridge.rs`) embeds this file verbatim and
// registers it as the main window's initialization script, after the two seed globals. It runs at
// document start on the sidecar origin, before page scripts, and is the only installer of the
// native bridge globals. It must stay a plain script: no imports, nothing the webview cannot run.
(() => {
	const g = globalThis;
	const CHROME_GLOBAL = "__THINKRAIL_INITIAL_WINDOW_CHROME__";
	const PREFS_GLOBAL = "__THINKRAIL_INITIAL_DESKTOP_PREFERENCES__";
	const ROUTE_PREFIX = "/view/";
	const MAX_INSET = 512;
	const MAX_PREF_KEY = 128;
	const MAX_PREF_VALUE = 262144;
	const MAX_NAVIGATION_DETAIL = 65536;
	const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;
	const INSET_LEFT_VAR = "--window-chrome-inset-left";
	const INSET_RIGHT_VAR = "--window-chrome-inset-right";
	const DRAG_REGION_ATTR = "data-window-chrome-drag-region";
	const TITLE_BAR_REGION_PROPERTY = "--electrobun-app-region";

	function isInset(value) {
		return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_INSET;
	}
	function writeWindowChrome(seed) {
		if (typeof document === "undefined") return;
		const root = document.documentElement;
		if (!root || typeof seed !== "object" || seed === null) return;
		if (isInset(seed.insetLeft) && isInset(seed.insetRight)) {
			try {
				root.style.setProperty(INSET_LEFT_VAR, `${seed.insetLeft}px`);
				root.style.setProperty(INSET_RIGHT_VAR, `${seed.insetRight}px`);
			} catch {}
		}
		if (typeof seed.dragRegion === "boolean") {
			try {
				root.setAttribute(DRAG_REGION_ATTR, seed.dragRegion ? "drag" : "no-drag");
			} catch {}
		}
	}

	const chromeSeed = g[CHROME_GLOBAL];
	writeWindowChrome(chromeSeed);
	if (typeof document !== "undefined" && document.addEventListener) {
		document.addEventListener("DOMContentLoaded", () => writeWindowChrome(chromeSeed), {
			once: true,
		});
	}

	const tauri = g.__TAURI__;
	if (typeof tauri?.core?.invoke !== "function" || typeof tauri?.event?.listen !== "function") {
		return;
	}
	function invoke(command, args) {
		return tauri.core.invoke(command, args ?? {});
	}
	/** Subscribe to a backend event; `onListening` runs once the backend holds the listener. */
	function onEvent(event, handler, onListening) {
		try {
			Promise.resolve(tauri.event.listen(event, (envelope) => handler(envelope.payload))).then(
				() => onListening?.(),
				() => {},
			);
		} catch {}
	}
	/** Fire-and-forget command: failures are swallowed like Electrobun sends. */
	function fire(command, args) {
		try {
			invoke(command, args).catch(() => {});
		} catch {}
	}
	function freezeGlobal(name, value) {
		try {
			Object.defineProperty(g, name, {
				value: Object.freeze(value),
				writable: false,
				configurable: false,
				enumerable: false,
			});
		} catch {}
	}
	function subscribeTo(listeners, listener) {
		listeners.push(listener);
		return () => {
			const index = listeners.indexOf(listener);
			if (index >= 0) listeners.splice(index, 1);
		};
	}
	function notifyAll(listeners, value) {
		for (const listener of listeners.slice()) listener(value);
	}
	function isElement(target) {
		return target !== null && typeof target === "object" && target.nodeType === 1;
	}
	function inDragRegion(target) {
		if (!isElement(target)) return false;
		try {
			const region = getComputedStyle(target).getPropertyValue(TITLE_BAR_REGION_PROPERTY);
			return String(region).trim().toLowerCase() === "drag";
		} catch {
			return false;
		}
	}

	let hasFocus = false;
	try {
		hasFocus = document.hasFocus();
	} catch {}
	if (typeof addEventListener === "function") {
		addEventListener("focus", () => {
			hasFocus = true;
		});
	}

	const quitHintListeners = [];
	const commandListeners = [];
	freezeGlobal("__THINKRAIL_NATIVE_SHORTCUTS__", {
		subscribeQuitHint: (listener) => subscribeTo(quitHintListeners, listener),
		subscribeCommand: (listener) => subscribeTo(commandListeners, listener),
		quit: () => invoke("quit_app").then(() => {}),
	});
	onEvent("quitHintChanged", (payload) => notifyAll(quitHintListeners, payload.hint));
	onEvent("nativeCommand", (payload) => notifyAll(commandListeners, payload.command));

	const updateListeners = [];
	freezeGlobal("__THINKRAIL_NATIVE_UPDATES__", {
		getState: () => invoke("get_update_state"),
		checkForUpdates: () => invoke("check_for_updates").then(() => {}),
		downloadUpdate: () => invoke("download_update").then(() => {}),
		restartToUpdate: () => invoke("restart_to_update").then(() => {}),
		dismissInstallResult: () => invoke("dismiss_install_result").then(() => {}),
		subscribe: (listener) => subscribeTo(updateListeners, listener),
	});
	onEvent("updateStateChanged", (state) => notifyAll(updateListeners, state));

	freezeGlobal("__THINKRAIL_NATIVE_PAGE_ZOOM__", {
		request: (action) => fire("page_zoom_requested", { action }),
	});

	const deepLinkListeners = [];
	const pendingDeepLinks = [];
	freezeGlobal("__THINKRAIL_NATIVE_DEEP_LINKS__", {
		subscribe: (listener) => {
			const unsubscribe = subscribeTo(deepLinkListeners, listener);
			for (const request of pendingDeepLinks.splice(0)) listener(request);
			return unsubscribe;
		},
	});
	// The shell buffers links until this document can receive them. Only report readiness once
	// the backend holds the `openFile` listener, or a link emitted in between would be lost.
	onEvent(
		"openFile",
		(request) => {
			if (deepLinkListeners.length === 0) pendingDeepLinks.push(request);
			else notifyAll(deepLinkListeners, request);
		},
		() => fire("deep_link_ready"),
	);

	freezeGlobal("__THINKRAIL_NATIVE_NOTIFICATIONS__", {
		show: (input) => {
			const args = { title: input.title, body: input.body };
			if (input.subtitle !== undefined) args.subtitle = input.subtitle;
			if (input.silent !== undefined) args.silent = input.silent;
			fire("show_notification", args);
		},
		isWindowFocused: () => hasFocus,
	});
	onEvent("windowFocusChanged", (payload) => {
		hasFocus = !!payload.focused;
	});

	const windowStateListeners = [];
	if (chromeSeed?.windowControls === true) {
		freezeGlobal("__THINKRAIL_NATIVE_WINDOW_CONTROLS__", {
			getState: () => invoke("get_window_state"),
			minimize: () => invoke("minimize_window").then(() => {}),
			toggleMaximize: () => invoke("toggle_maximize_window").then(() => {}),
			close: () => invoke("close_window").then(() => {}),
			subscribe: (listener) => subscribeTo(windowStateListeners, listener),
		});
	}
	onEvent("windowStateChanged", (state) => notifyAll(windowStateListeners, state));
	onEvent("windowChromeChanged", (geometry) => writeWindowChrome(geometry));

	freezeGlobal("__THINKRAIL_NATIVE_MENU__", {
		setLabels: (labels) => fire("menu_labels_changed", { labels: { ...labels } }),
	});

	function isPreferenceKey(key) {
		if (typeof key !== "string" || key.length === 0 || key.length > MAX_PREF_KEY) return false;
		for (let index = 0; index < key.length; index += 1) {
			const code = key.charCodeAt(index);
			if (code <= 31 || code === 127) return false;
		}
		return true;
	}
	function isPreferenceValue(value) {
		return typeof value === "string" && value.length <= MAX_PREF_VALUE;
	}
	const injectedPreferences = g[PREFS_GLOBAL];
	const preferences = new Map();
	if (typeof injectedPreferences === "object" && injectedPreferences !== null) {
		for (const key of Object.keys(injectedPreferences)) {
			const value = injectedPreferences[key];
			if (isPreferenceKey(key) && isPreferenceValue(value)) preferences.set(key, value);
		}
	}
	freezeGlobal("__THINKRAIL_STABLE_PREFERENCES__", {
		getItem: (key) => (isPreferenceKey(key) ? (preferences.get(key) ?? null) : null),
		setItem: (key, value) => {
			if (!isPreferenceKey(key) || !isPreferenceValue(value)) return;
			preferences.set(key, value);
			fire("preference_write", { key, value });
		},
		removeItem: (key) => {
			if (!isPreferenceKey(key)) return;
			preferences.delete(key);
			fire("preference_remove", { key });
		},
	});

	try {
		delete g[PREFS_GLOBAL];
	} catch {}
	try {
		delete g[CHROME_GLOBAL];
	} catch {}

	if (typeof addEventListener === "function") {
		// The web marks its title bar with the Electrobun drag-region property. Tauri has no such
		// CSS hook, so a primary press there asks the shell to start a native window move.
		addEventListener("mousedown", (event) => {
			if (event?.button !== 0 || event.detail !== 1 || event.defaultPrevented) return;
			if (inDragRegion(event.target)) fire("start_window_drag");
		});
		addEventListener("dblclick", (event) => {
			if (event?.button !== 0 || event.defaultPrevented) return;
			if (inDragRegion(event.target)) fire("title_bar_double_click");
		});
	}

	function pageZoomActionForShortcut(event, platform) {
		const hasModifier = APPLE_PLATFORM.test(platform)
			? event.metaKey && !event.ctrlKey
			: event.ctrlKey && !event.metaKey;
		if (!hasModifier || event.altKey) return null;
		if (event.key === "+" || event.key === "=") return "in";
		if (event.key === "-") return "out";
		return event.key === "0" ? "reset" : null;
	}
	let platformName = "";
	try {
		platformName = navigator.platform ?? "";
	} catch {}
	if (typeof addEventListener === "function") {
		addEventListener("keydown", (event) => {
			if (!event || event.defaultPrevented) return;
			const action = pageZoomActionForShortcut(event, platformName);
			if (!action) return;
			event.preventDefault();
			fire("page_zoom_requested", { action });
		});
		if (APPLE_PLATFORM.test(platformName)) {
			let gestureActive = false;
			addEventListener(
				"gesturestart",
				(event) => {
					if (!event || event.defaultPrevented) return;
					gestureActive = true;
					event.preventDefault();
					fire("page_zoom_gesture_requested", { phase: "start" });
				},
				{ passive: false },
			);
			addEventListener(
				"gesturechange",
				(event) => {
					if (!gestureActive || !event || event.defaultPrevented) return;
					const scale = event.scale;
					if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) return;
					event.preventDefault();
					fire("page_zoom_gesture_requested", { phase: "change", scale });
				},
				{ passive: false },
			);
			addEventListener(
				"gestureend",
				(event) => {
					if (!gestureActive) return;
					gestureActive = false;
					event?.preventDefault();
					fire("page_zoom_gesture_requested", { phase: "end" });
				},
				{ passive: false },
			);
		}
	}

	function externalNavigationUrl(value, origin) {
		let detail = value;
		if (typeof detail === "string") {
			if (detail.length > MAX_NAVIGATION_DETAIL) return null;
			if (detail.trimStart().startsWith("{")) {
				try {
					detail = JSON.parse(detail);
				} catch {
					return null;
				}
			}
		}
		let raw = null;
		if (typeof detail === "string") raw = detail;
		else if (
			typeof detail === "object" &&
			detail !== null &&
			!Array.isArray(detail) &&
			typeof detail.url === "string"
		) {
			raw = detail.url;
		}
		if (!raw || raw.length > MAX_NAVIGATION_DETAIL) return null;
		try {
			const url = new URL(raw, origin);
			if (url.origin === origin) return url.pathname.startsWith(ROUTE_PREFIX) ? url.href : null;
			return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
		} catch {
			return null;
		}
	}
	// External destinations are handed to the webview as a navigation. The shell's navigation
	// policy (`navigation.rs`) refuses to load them and opens the system browser instead, so the
	// allowlist has one owner and still holds if a page navigates without going through here.
	function installExternalLinkRouting(scope) {
		const route = (event) => {
			if (!event || event.defaultPrevented || event.button > 1 || event.ctrlKey || event.metaKey) {
				return;
			}
			const target = event.target;
			const anchor =
				isElement(target) && typeof target.closest === "function"
					? target.closest("a[href]")
					: null;
			if (!anchor || anchor.hasAttribute?.("download") || typeof anchor.href !== "string") return;
			const destination = externalNavigationUrl(anchor.href, scope.location.origin);
			if (!destination) return;
			event.preventDefault();
			scope.location.assign(destination);
		};
		scope.addEventListener("click", route);
		scope.addEventListener("auxclick", route);
		const open = scope.open.bind(scope);
		scope.open = (url, targetName, features) => {
			const destination =
				url === undefined ? null : externalNavigationUrl(String(url), scope.location.origin);
			if (!destination) return open(url, targetName, features);
			scope.location.assign(destination);
			return null;
		};
	}
	try {
		if (typeof window !== "undefined" && window.addEventListener) {
			installExternalLinkRouting(window);
		}
	} catch {}

	function sendRoute() {
		let hash = "";
		try {
			hash = window.location.hash;
		} catch {}
		fire("route_changed", { hash });
	}
	try {
		if (typeof history !== "undefined" && history.replaceState && history.pushState) {
			const originalReplaceState = history.replaceState.bind(history);
			history.replaceState = (...args) => {
				originalReplaceState(...args);
				sendRoute();
			};
			const originalPushState = history.pushState.bind(history);
			history.pushState = (...args) => {
				originalPushState(...args);
				sendRoute();
			};
		}
	} catch {}
	if (typeof addEventListener === "function") {
		addEventListener("hashchange", sendRoute);
		addEventListener("popstate", sendRoute);
		addEventListener("DOMContentLoaded", sendRoute);
	}
	queueMicrotask(sendRoute);
})();
