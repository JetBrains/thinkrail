export interface StablePreferenceAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const STABLE_PREFERENCES_GLOBAL = "__THINKRAIL_STABLE_PREFERENCES__";

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
