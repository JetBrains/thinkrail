import type { KeyValueStore } from "@thinkrail/remote-client";

/** Capacitor runs in a WKWebView, so localStorage persists on-device — no native plugin needed here. */
export const localStore: KeyValueStore = {
	read: (key) => localStorage.getItem(key),
	write: (key, value) => localStorage.setItem(key, value),
};
