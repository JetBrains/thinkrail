export const INITIAL_DESKTOP_PREFERENCES_GLOBAL = "__THINKRAIL_INITIAL_DESKTOP_PREFERENCES__";
export const STABLE_PREFERENCES_GLOBAL = "__THINKRAIL_STABLE_PREFERENCES__";
export const MAX_DESKTOP_PREFERENCE_KEY_LENGTH = 128;
export const MAX_DESKTOP_PREFERENCE_VALUE_LENGTH = 4096;
export const MAX_DESKTOP_PREFERENCE_SCOPE_ID_LENGTH = 128;

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

export function isDesktopPreferenceKey(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_DESKTOP_PREFERENCE_KEY_LENGTH &&
		!hasControlCharacter(value)
	);
}

export function isDesktopPreferenceValue(value: unknown): value is string {
	return typeof value === "string" && value.length <= MAX_DESKTOP_PREFERENCE_VALUE_LENGTH;
}

export function isDesktopPreferenceScopeId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_DESKTOP_PREFERENCE_SCOPE_ID_LENGTH &&
		!hasControlCharacter(value)
	);
}

export function readDesktopPreferenceWrite(
	payload: unknown,
): { key: string; value: string } | null {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
	const key = Reflect.get(payload, "key");
	const value = Reflect.get(payload, "value");
	return isDesktopPreferenceKey(key) && isDesktopPreferenceValue(value) ? { key, value } : null;
}

export function readDesktopPreferenceRemove(payload: unknown): { key: string } | null {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
	const key = Reflect.get(payload, "key");
	return isDesktopPreferenceKey(key) ? { key } : null;
}

function serializeForPreload(values: Readonly<Record<string, string>>): string {
	return JSON.stringify(JSON.stringify(values))
		.replaceAll("<", "\\u003c")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

export function injectInitialDesktopPreferences(
	preloadSource: string,
	values: Readonly<Record<string, string>>,
): string {
	return `Object.defineProperty(globalThis, ${JSON.stringify(INITIAL_DESKTOP_PREFERENCES_GLOBAL)}, { value: JSON.parse(${serializeForPreload(values)}), configurable: true });\n${preloadSource}`;
}
