import type { NativeLocaleBridge } from "@thinkrail/contracts";

export interface StablePreferenceAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const STABLE_PREFERENCES_GLOBAL = "__THINKRAIL_STABLE_PREFERENCES__";
const NATIVE_LOCALE_GLOBAL = "__THINKRAIL_NATIVE_LOCALE__";

export function asStablePreferenceAdapter(value: unknown): StablePreferenceAdapter | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? typeof Reflect.get(value, "getItem") === "function" &&
			typeof Reflect.get(value, "setItem") === "function" &&
			typeof Reflect.get(value, "removeItem") === "function"
			? (value as StablePreferenceAdapter)
			: null
		: null;
}

export function getStablePreferenceAdapter(): StablePreferenceAdapter | null {
	return asStablePreferenceAdapter(Reflect.get(globalThis, STABLE_PREFERENCES_GLOBAL));
}

/**
 * The desktop-only bridge for the interface language. Absent in the browser, which switches locale with
 * a plain reload because it has no native menu to rebuild.
 */
export function getNativeLocaleAdapter(): NativeLocaleBridge | null {
	return asNativeLocaleBridge(Reflect.get(globalThis, NATIVE_LOCALE_GLOBAL));
}

export function asNativeLocaleBridge(value: unknown): NativeLocaleBridge | null {
	return typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof Reflect.get(value, "applyLocale") === "function"
		? (value as NativeLocaleBridge)
		: null;
}
