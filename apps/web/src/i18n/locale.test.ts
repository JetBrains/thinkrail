import { afterEach, describe, expect, test } from "bun:test";
import {
	applyLocale,
	getLocale,
	normalizeLocale,
	resetLocaleCache,
	setLocale,
	storedLocale,
} from "./locale";

const STABLE_PREFERENCES_GLOBAL = "__THINKRAIL_STABLE_PREFERENCES__";
const NATIVE_LOCALE_GLOBAL = "__THINKRAIL_NATIVE_LOCALE__";
const LOCAL_STORAGE_KEY = "thinkrail.locale";
const PREFERENCE_KEY = "thinkrail-locale";

function storage(initial: Record<string, string> = {}): Storage {
	const store = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		},
	} satisfies Storage;
}

function stableAdapter(initial: Record<string, string>) {
	const store = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
	};
}

function setLocalStorage(value: Storage): void {
	Object.defineProperty(globalThis, "localStorage", { configurable: true, value });
}

function setGlobal(name: string, value: unknown): void {
	Object.defineProperty(globalThis, name, { configurable: true, value });
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, STABLE_PREFERENCES_GLOBAL);
	Reflect.deleteProperty(globalThis, NATIVE_LOCALE_GLOBAL);
	setLocalStorage(storage());
	resetLocaleCache();
});

describe("normalizeLocale", () => {
	test("folds every Chinese variant and English variant onto the two shipped locales", () => {
		expect(normalizeLocale("zh-Hans-CN")).toBe("zh-CN");
		expect(normalizeLocale("zh_CN")).toBe("zh-CN");
		expect(normalizeLocale("ZH")).toBe("zh-CN");
		expect(normalizeLocale("en-GB")).toBe("en");
		expect(normalizeLocale("fr-FR")).toBeNull();
		expect(normalizeLocale(null)).toBeNull();
	});
});

describe("storedLocale", () => {
	test("prefers the session's own choice over the preload snapshot", () => {
		// The desktop preload seeds the adapter from a snapshot taken when the window was created, so it
		// still holds the previous language while `localStorage` holds the one just picked.
		setGlobal(STABLE_PREFERENCES_GLOBAL, stableAdapter({ [PREFERENCE_KEY]: "en" }));
		setLocalStorage(storage({ [LOCAL_STORAGE_KEY]: "zh-CN" }));
		expect(storedLocale()).toBe("zh-CN");
	});

	test("falls back to the native preference when there is no session choice", () => {
		setGlobal(STABLE_PREFERENCES_GLOBAL, stableAdapter({ [PREFERENCE_KEY]: "zh-CN" }));
		setLocalStorage(storage());
		expect(storedLocale()).toBe("zh-CN");
	});

	test("normalizes an alias written by an older build", () => {
		setGlobal(STABLE_PREFERENCES_GLOBAL, stableAdapter({ [PREFERENCE_KEY]: "zh-Hans" }));
		setLocalStorage(storage());
		expect(storedLocale()).toBe("zh-CN");
	});

	test("ignores storage that is unavailable", () => {
		setGlobal(STABLE_PREFERENCES_GLOBAL, stableAdapter({ [PREFERENCE_KEY]: "zh-CN" }));
		setLocalStorage(
			Object.assign({}, storage(), {
				getItem: () => {
					throw new Error("storage is blocked");
				},
			}) as Storage,
		);
		expect(storedLocale()).toBe("zh-CN");
	});

	test("reports no choice when neither source has one", () => {
		setLocalStorage(storage());
		expect(storedLocale()).toBeNull();
	});
});

describe("setLocale", () => {
	test("writes both the session copy and the native preference", () => {
		const native = stableAdapter({});
		setGlobal(STABLE_PREFERENCES_GLOBAL, native);
		const local = storage();
		setLocalStorage(local);

		setLocale("zh-CN");

		expect(local.getItem(LOCAL_STORAGE_KEY)).toBe("zh-CN");
		expect(native.getItem(PREFERENCE_KEY)).toBe("zh-CN");
		expect(getLocale()).toBe("zh-CN");
	});
});

describe("applyLocale", () => {
	test("leaves the reload to the caller when there is no document", () => {
		setLocalStorage(storage());
		expect(() => applyLocale("zh-CN")).not.toThrow();
		expect(storedLocale()).toBe("zh-CN");
	});

	test("reloads through the native handshake so the preload re-seeds the new language", async () => {
		const calls: string[] = [];
		let release = () => {};
		const settled = new Promise<void>((resolve) => {
			release = resolve;
		});
		setGlobal(STABLE_PREFERENCES_GLOBAL, stableAdapter({ [PREFERENCE_KEY]: "en" }));
		setLocalStorage(storage({ [LOCAL_STORAGE_KEY]: "en" }));
		setGlobal(NATIVE_LOCALE_GLOBAL, {
			applyLocale: async (locale: string) => {
				calls.push(`apply:${locale}`);
				await settled;
				return true;
			},
		});
		const reloads: string[] = [];
		Object.defineProperty(globalThis, "location", {
			configurable: true,
			value: { reload: () => reloads.push("reload") },
		});

		try {
			applyLocale("zh-CN");
			// The reload waits for the desktop to persist the preference and rebuild its menu.
			expect(calls).toEqual(["apply:zh-CN"]);
			expect(reloads).toEqual([]);

			release();
			await settled;
			await Promise.resolve();
			await Promise.resolve();
			expect(reloads).toEqual(["reload"]);
		} finally {
			Reflect.deleteProperty(globalThis, "location");
		}
	});

	test("still reloads when the native handshake fails", async () => {
		setGlobal(NATIVE_LOCALE_GLOBAL, {
			applyLocale: async () => {
				throw new Error("no desktop");
			},
		});
		const reloads: string[] = [];
		Object.defineProperty(globalThis, "location", {
			configurable: true,
			value: { reload: () => reloads.push("reload") },
		});

		try {
			applyLocale("zh-CN");
			for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
			expect(reloads).toEqual(["reload"]);
		} finally {
			Reflect.deleteProperty(globalThis, "location");
		}
	});
});
