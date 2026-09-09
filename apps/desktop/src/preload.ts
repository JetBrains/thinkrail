import type { NativeUpdateBridge, NativeUpdateState } from "@thinkrail/contracts";
import Electrobun, { Electroview } from "electrobun/view";
import {
	INITIAL_DESKTOP_PREFERENCES_GLOBAL,
	isDesktopPreferenceKey,
	isDesktopPreferenceValue,
	STABLE_PREFERENCES_GLOBAL,
} from "./preferenceAdapter";
import type { DesktopRpc } from "./rpc";

interface DesktopPreferenceAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const updateListeners = new Set<(state: NativeUpdateState) => void>();
let latestUpdateState: NativeUpdateState | undefined;
const acceptUpdateState = (state: NativeUpdateState): NativeUpdateState => {
	if (latestUpdateState && latestUpdateState.revision >= state.revision) return latestUpdateState;
	latestUpdateState = state;
	for (const listener of updateListeners) listener(state);
	return state;
};
const rpc = Electroview.defineRPC<DesktopRpc>({
	maxRequestTime: 5000,
	handlers: {
		requests: {},
		messages: { updateStateChanged: acceptUpdateState },
	},
});
const electroview = new Electrobun.Electroview({ rpc });
const globals = globalThis as typeof globalThis & Record<string, unknown>;
const updateBridge: NativeUpdateBridge = Object.freeze({
	getState: async () => {
		const fetched = await rpc.request.getUpdateState();
		if (latestUpdateState && latestUpdateState.revision > fetched.revision) {
			return latestUpdateState;
		}
		latestUpdateState = fetched;
		return fetched;
	},
	checkForUpdates: async () => {
		await rpc.request.checkForUpdates();
	},
	restartToUpdate: async () => {
		await rpc.request.restartToUpdate();
	},
	subscribe: (listener: (state: NativeUpdateState) => void) => {
		updateListeners.add(listener);
		return () => updateListeners.delete(listener);
	},
});
Object.defineProperty(globals, "__THINKRAIL_NATIVE_UPDATES__", {
	value: updateBridge,
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
