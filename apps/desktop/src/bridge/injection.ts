/**
 * Tauri initialization-script generator for the desktop bridge.
 *
 * `tauriInitializationScript()` returns a single self-contained JS string that
 * the Rust shell registers as a Tauri initialization script (runs at
 * document start, before page scripts, with `withGlobalTauri` enabled). The
 * script carries:
 *
 * 1. the seed globals `__THINKRAIL_INITIAL_WINDOW_CHROME__` and
 *    `__THINKRAIL_INITIAL_DESKTOP_PREFERENCES__` (configurable, so the bridge
 *    consumes them exactly like `takePreloadGlobal`),
 * 2. the first-paint window-chrome CSS writer (same vars/attribute as
 *    `createWindowChromeStyleWriter`: `--window-chrome-inset-left/right` plus
 *    `data-window-chrome-drag-region`), applied immediately and again on
 *    `DOMContentLoaded`, and
 * 3. the bridge source: the same frozen non-enumerable globals
 *    `src/bridge/bridge.ts` installs, implemented here against
 *    `globalThis.__TAURI__` (`core.invoke` / `event.listen`) because an
 *    initialization script cannot import npm modules. Keep the two in sync;
 *    `injection.test.ts` executes this script and asserts the web
 *    shape-guards accept every global.
 */
import { WORKSPACE_VIEW_ROUTE } from "@thinkrail/contracts";
import { INITIAL_DESKTOP_PREFERENCES_GLOBAL } from "../preferenceAdapter";
import { INITIAL_WINDOW_CHROME_GLOBAL, type WindowChromePreloadSeed } from "../windowChrome";

export interface TauriWindowSeed {
	windowChrome: WindowChromePreloadSeed;
	preferences: Readonly<Record<string, string>>;
}

function serializeSeedValue(value: unknown): string {
	return JSON.stringify(JSON.stringify(value))
		.replaceAll("<", "\\u003c")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

function seedGlobalLine(globalName: string, value: unknown): string {
	return `Object.defineProperty(globalThis, ${JSON.stringify(globalName)}, { value: JSON.parse(${serializeSeedValue(value)}), configurable: true });`;
}

/**
 * The bridge runtime. Written without imports, template literals, or `${`
 * so it embeds verbatim in the generated script. `__SEED_*__` placeholders
 * are substituted by `tauriInitializationScript()` with the real
 * (JSON-quoted) global names and route prefix.
 */
const TAURI_BRIDGE_BOOTSTRAP = `(function () {
  var g = globalThis;
  var CHROME_GLOBAL = __SEED_CHROME__;
  var PREFS_GLOBAL = __SEED_PREFS__;
  var ROUTE_PREFIX = __SEED_ROUTE__;
  var MAX_INSET = 512;
  var MAX_PREF_KEY = 128;
  var MAX_PREF_VALUE = 262144;
  var APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;
  var INSET_LEFT_VAR = "--window-chrome-inset-left";
  var INSET_RIGHT_VAR = "--window-chrome-inset-right";
  var DRAG_REGION_ATTR = "data-window-chrome-drag-region";
  var TITLE_BAR_REGION_PROPERTY = "--electrobun-app-region";
  var MAX_NAVIGATION_DETAIL = 65536;

  function isInset(value) {
    return typeof value === "number" && isFinite(value) && value >= 0 && value <= MAX_INSET;
  }
  function writeWindowChrome(seed) {
    if (typeof document === "undefined") return;
    var root = document.documentElement;
    if (!root || typeof seed !== "object" || seed === null) return;
    if (isInset(seed.insetLeft) && isInset(seed.insetRight)) {
      try {
        root.style.setProperty(INSET_LEFT_VAR, seed.insetLeft + "px");
        root.style.setProperty(INSET_RIGHT_VAR, seed.insetRight + "px");
      } catch (ignore) {}
    }
    if (typeof seed.dragRegion === "boolean") {
      try {
        root.setAttribute(DRAG_REGION_ATTR, seed.dragRegion ? "drag" : "no-drag");
      } catch (ignore) {}
    }
  }

  var chromeSeed = g[CHROME_GLOBAL];
  writeWindowChrome(chromeSeed);
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("DOMContentLoaded", function () { writeWindowChrome(chromeSeed); }, { once: true });
  }

  var tauri = g.__TAURI__;
  if (!tauri || !tauri.core || !tauri.event || typeof tauri.core.invoke !== "function" || typeof tauri.event.listen !== "function") return;
  function invoke(cmd, args) { return tauri.core.invoke(cmd, args || {}); }
  function onEvent(event, handler) {
    try {
      var pending = tauri.event.listen(event, function (envelope) { handler(envelope.payload); });
      if (pending && typeof pending.catch === "function") pending.catch(function () {});
    } catch (ignore) {}
  }
  function fire(command, args) {
    try {
      invoke(command, args).catch(function () {});
    } catch (ignore) {}
  }
  function freezeGlobal(name, value) {
    try {
      Object.defineProperty(g, name, { value: Object.freeze(value), writable: false, configurable: false, enumerable: false });
    } catch (ignore) {}
  }
  function unsubscribeFrom(listeners, listener) {
    return function () {
      var index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  }
  function notifyAll(listeners, value) {
    listeners.slice().forEach(function (listener) { listener(value); });
  }

  var hasFocus = false;
  try { hasFocus = document.hasFocus(); } catch (ignore) {}
  function markFocused() { hasFocus = true; }
  if (typeof addEventListener === "function") addEventListener("focus", markFocused);

  var quitHintListeners = [];
  var commandListeners = [];
  freezeGlobal("__THINKRAIL_NATIVE_SHORTCUTS__", {
    subscribeQuitHint: function (listener) { quitHintListeners.push(listener); return unsubscribeFrom(quitHintListeners, listener); },
    subscribeCommand: function (listener) { commandListeners.push(listener); return unsubscribeFrom(commandListeners, listener); },
    quit: function () { return invoke("quit_app"); }
  });
  onEvent("quitHintChanged", function (payload) { notifyAll(quitHintListeners, payload.hint); });
  onEvent("nativeCommand", function (payload) { notifyAll(commandListeners, payload.command); });

  var updateListeners = [];
  freezeGlobal("__THINKRAIL_NATIVE_UPDATES__", {
    getState: function () { return invoke("get_update_state"); },
    checkForUpdates: function () { return invoke("check_for_updates").then(function () {}); },
    downloadUpdate: function () { return invoke("download_update").then(function () {}); },
    restartToUpdate: function () { return invoke("restart_to_update").then(function () {}); },
    dismissInstallResult: function () { return invoke("dismiss_install_result").then(function () {}); },
    subscribe: function (listener) { updateListeners.push(listener); return unsubscribeFrom(updateListeners, listener); }
  });
  onEvent("updateStateChanged", function (state) { notifyAll(updateListeners, state); });

  freezeGlobal("__THINKRAIL_NATIVE_PAGE_ZOOM__", {
    request: function (action) { fire("page_zoom_requested", { action: action }); }
  });

  var deepLinkListeners = [];
  var pendingDeepLinks = [];
  freezeGlobal("__THINKRAIL_NATIVE_DEEP_LINKS__", {
    subscribe: function (listener) {
      deepLinkListeners.push(listener);
      pendingDeepLinks.splice(0).forEach(function (request) { listener(request); });
      return unsubscribeFrom(deepLinkListeners, listener);
    }
  });
  onEvent("openFile", function (request) {
    if (deepLinkListeners.length === 0) { pendingDeepLinks.push(request); return; }
    notifyAll(deepLinkListeners, request);
  });

  freezeGlobal("__THINKRAIL_NATIVE_NOTIFICATIONS__", {
    show: function (input) {
      var args = { title: input.title, body: input.body };
      if (input.subtitle !== undefined) args.subtitle = input.subtitle;
      if (input.silent !== undefined) args.silent = input.silent;
      fire("show_notification", args);
    },
    isWindowFocused: function () { return hasFocus; }
  });
  onEvent("windowFocusChanged", function (payload) { hasFocus = !!payload.focused; });

  var windowStateListeners = [];
  if (chromeSeed && chromeSeed.windowControls === true) {
    freezeGlobal("__THINKRAIL_NATIVE_WINDOW_CONTROLS__", {
      getState: function () { return invoke("get_window_state"); },
      minimize: function () { return invoke("minimize_window").then(function () {}); },
      toggleMaximize: function () { return invoke("toggle_maximize_window").then(function () {}); },
      close: function () { return invoke("close_window").then(function () {}); },
      subscribe: function (listener) { windowStateListeners.push(listener); return unsubscribeFrom(windowStateListeners, listener); }
    });
  }
  onEvent("windowStateChanged", function (state) { notifyAll(windowStateListeners, state); });
  onEvent("windowChromeChanged", function (geometry) { writeWindowChrome(geometry); });

  freezeGlobal("__THINKRAIL_NATIVE_MENU__", {
    setLabels: function (labels) {
      var copy = {};
      for (var key in labels) {
        if (Object.prototype.hasOwnProperty.call(labels, key)) copy[key] = labels[key];
      }
      fire("menu_labels_changed", { labels: copy });
    }
  });

  function isPreferenceKey(key) {
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_PREF_KEY) return false;
    for (var i = 0; i < key.length; i++) {
      var code = key.charCodeAt(i);
      if (code <= 31 || code === 127) return false;
    }
    return true;
  }
  function isPreferenceValue(value) {
    return typeof value === "string" && value.length <= MAX_PREF_VALUE;
  }
  var injectedPreferences = g[PREFS_GLOBAL];
  var preferences = {};
  if (injectedPreferences && typeof injectedPreferences === "object") {
    for (var prefKey in injectedPreferences) {
      if (Object.prototype.hasOwnProperty.call(injectedPreferences, prefKey) && isPreferenceKey(prefKey) && isPreferenceValue(injectedPreferences[prefKey])) {
        preferences[prefKey] = injectedPreferences[prefKey];
      }
    }
  }
  freezeGlobal("__THINKRAIL_STABLE_PREFERENCES__", {
    getItem: function (key) {
      if (!isPreferenceKey(key)) return null;
      return Object.prototype.hasOwnProperty.call(preferences, key) ? preferences[key] : null;
    },
    setItem: function (key, value) {
      if (!isPreferenceKey(key) || !isPreferenceValue(value)) return;
      preferences[key] = value;
      fire("preference_write", { key: key, value: value });
    },
    removeItem: function (key) {
      if (!isPreferenceKey(key)) return;
      delete preferences[key];
      fire("preference_remove", { key: key });
    }
  });

  try { delete g[PREFS_GLOBAL]; } catch (ignore) {}
  try { delete g[CHROME_GLOBAL]; } catch (ignore) {}

  if (typeof addEventListener === "function") {
    addEventListener("dblclick", function (event) {
      if (!event || event.button !== 0 || event.defaultPrevented) return;
      var target = event.target;
      if (!target || typeof target !== "object" || target.nodeType !== 1) return;
      try {
        var region = getComputedStyle(target).getPropertyValue(TITLE_BAR_REGION_PROPERTY);
        if (String(region).trim().toLowerCase() !== "drag") return;
      } catch (ignore) { return; }
      fire("title_bar_double_click");
    });
  }

  function pageZoomActionForShortcut(event, platform) {
    var hasModifier = APPLE_PLATFORM.test(platform || "")
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
    if (!hasModifier || event.altKey) return null;
    if (event.key === "+" || event.key === "=") return "in";
    if (event.key === "-") return "out";
    return event.key === "0" ? "reset" : null;
  }
  var platformName = "";
  try { platformName = navigator.platform; } catch (ignore) {}
  if (typeof addEventListener === "function") {
    addEventListener("keydown", function (event) {
      if (!event || event.defaultPrevented) return;
      var action = pageZoomActionForShortcut(event, platformName);
      if (!action) return;
      try { event.preventDefault(); } catch (ignore) {}
      fire("page_zoom_requested", { action: action });
    });
    if (APPLE_PLATFORM.test(platformName)) {
      var gestureActive = false;
      addEventListener("gesturestart", function (event) {
        if (!event || event.defaultPrevented) return;
        gestureActive = true;
        try { event.preventDefault(); } catch (ignore) {}
        fire("page_zoom_gesture_requested", { phase: "start" });
      }, { passive: false });
      addEventListener("gesturechange", function (event) {
        if (!gestureActive || !event || event.defaultPrevented) return;
        if (typeof event.scale !== "number" || !isFinite(event.scale) || event.scale <= 0) return;
        try { event.preventDefault(); } catch (ignore) {}
        fire("page_zoom_gesture_requested", { phase: "change", scale: event.scale });
      }, { passive: false });
      addEventListener("gestureend", function (event) {
        if (!gestureActive) return;
        gestureActive = false;
        try { if (event) event.preventDefault(); } catch (ignore) {}
        fire("page_zoom_gesture_requested", { phase: "end" });
      }, { passive: false });
    }
  }

  function externalNavigationUrl(value, origin) {
    var detail = value;
    if (typeof detail === "string" && detail.length <= MAX_NAVIGATION_DETAIL) {
      var trimmed = detail.replace(/^\\s+/, "");
      if (trimmed.charAt(0) === "{") {
        try { detail = JSON.parse(detail); } catch (ignore) { return null; }
      }
    }
    var raw = null;
    if (typeof detail === "string") raw = detail;
    else if (detail && typeof detail === "object" && !Array.isArray(detail) && typeof detail.url === "string") raw = detail.url;
    if (!raw || raw.length > MAX_NAVIGATION_DETAIL) return null;
    var url;
    try { url = new URL(raw, origin); } catch (ignore) { return null; }
    if (url.origin === origin) return url.pathname.indexOf(ROUTE_PREFIX) === 0 ? url.href : null;
    if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:") return url.href;
    return null;
  }
  function installExternalLinkRouting(scope, origin) {
    var route = function (event) {
      if (!event || event.defaultPrevented || event.button > 1 || event.ctrlKey || event.metaKey) return;
      var target = event.target;
      var anchor = null;
      if (target && typeof target === "object" && target.nodeType === 1 && typeof target.closest === "function") {
        anchor = target.closest("a[href]");
      }
      if (!anchor || (anchor.hasAttribute && anchor.hasAttribute("download")) || typeof anchor.href !== "string") return;
      var destination = externalNavigationUrl(anchor.href, origin);
      if (!destination) return;
      try { event.preventDefault(); } catch (ignore) {}
      try { scope.location.assign(destination); } catch (ignore) {}
    };
    scope.addEventListener("click", route);
    scope.addEventListener("auxclick", route);
    try {
      var open = scope.open.bind(scope);
      scope.open = function (url, targetName, features) {
        var destination = url === undefined ? null : externalNavigationUrl(String(url), scope.location.origin);
        if (!destination) return open(url, targetName, features);
        try { scope.location.assign(destination); } catch (ignore) {}
        return null;
      };
    } catch (ignore) {}
  }
  try {
    if (typeof window !== "undefined" && window.addEventListener) {
      installExternalLinkRouting(window, window.location.origin);
    }
  } catch (ignore) {}

  function sendRoute() {
    var hash = "";
    try { hash = window.location.hash; } catch (ignore) {}
    fire("route_changed", { hash: hash });
  }
  try {
    if (typeof history !== "undefined" && history.replaceState && history.pushState) {
      var originalReplaceState = history.replaceState.bind(history);
      history.replaceState = function () {
        var result = originalReplaceState.apply(null, arguments);
        sendRoute();
        return result;
      };
      var originalPushState = history.pushState.bind(history);
      history.pushState = function () {
        var result = originalPushState.apply(null, arguments);
        sendRoute();
        return result;
      };
    }
  } catch (ignore) {}
  if (typeof addEventListener === "function") {
    addEventListener("hashchange", sendRoute);
    addEventListener("popstate", sendRoute);
    addEventListener("DOMContentLoaded", sendRoute);
  }
  if (typeof queueMicrotask === "function") queueMicrotask(sendRoute);
  else if (typeof setTimeout === "function") setTimeout(sendRoute, 0);
})();`;

/**
 * Build the Tauri initialization script for one window: seed globals plus the
 * bridge source. Register the result with
 * `WebviewWindowBuilder::initialization_script` (or an equivalent build step)
 * so the web shape-guards see the same globals as under Electrobun.
 */
export function tauriInitializationScript(windowSeed: TauriWindowSeed): string {
	const chromeName = JSON.stringify(INITIAL_WINDOW_CHROME_GLOBAL);
	const prefsName = JSON.stringify(INITIAL_DESKTOP_PREFERENCES_GLOBAL);
	const routePrefix = JSON.stringify(WORKSPACE_VIEW_ROUTE);
	const bootstrap = TAURI_BRIDGE_BOOTSTRAP.replaceAll("__SEED_CHROME__", chromeName)
		.replaceAll("__SEED_PREFS__", prefsName)
		.replaceAll("__SEED_ROUTE__", routePrefix);
	return (
		`${seedGlobalLine(INITIAL_WINDOW_CHROME_GLOBAL, windowSeed.windowChrome)}\n` +
		`${seedGlobalLine(INITIAL_DESKTOP_PREFERENCES_GLOBAL, windowSeed.preferences)}\n` +
		`${bootstrap}\n`
	);
}
