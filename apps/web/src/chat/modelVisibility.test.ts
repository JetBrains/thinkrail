import { afterEach, describe, expect, test } from "bun:test";
import type { StablePreferenceAdapter } from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";
import {
	type BrowserPreferenceTarget,
	HIDDEN_MODELS_PREFERENCE_KEY,
	hiddenModelsFromStorageEvent,
	hiddenModelsStorageKey,
	initModelVisibilityPersistence,
	parseHiddenModels,
} from "./modelVisibility";

const GPT = { provider: "openai", id: "gpt" };
const OPUS = { provider: "anthropic", id: "opus" };

function memoryAdapter(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const adapter: StablePreferenceAdapter = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
	};
	return { adapter, values };
}

const throwing: StablePreferenceAdapter = {
	getItem: () => {
		throw new Error("denied");
	},
	setItem: () => {
		throw new Error("quota");
	},
	removeItem: () => {
		throw new Error("denied");
	},
};

function fakeBrowser(storage: Storage) {
	const listeners = new Set<(event: StorageEvent) => void>();
	const target: BrowserPreferenceTarget = {
		storage,
		key: hiddenModelsStorageKey("http://localhost:31415"),
		events: {
			addEventListener: (_type: string, listener: (event: StorageEvent) => void) =>
				listeners.add(listener),
			removeEventListener: (_type: string, listener: (event: StorageEvent) => void) =>
				listeners.delete(listener),
		} as BrowserPreferenceTarget["events"],
	};
	const dispatch = (event: Pick<StorageEvent, "key" | "newValue" | "storageArea">) => {
		for (const listener of listeners) listener(event as StorageEvent);
	};
	return { target, listeners, dispatch };
}

afterEach(() => useAppStore.getState().hydrateHiddenModels([]));

describe("hidden models parsing", () => {
	test("keeps only well-formed refs", () => {
		expect(
			parseHiddenModels(
				JSON.stringify([GPT, { provider: 1, id: "x" }, null, "x", { ...OPUS, extra: true }]),
			),
		).toEqual([GPT, OPUS]);
	});

	test("bad JSON and non-arrays read as nothing hidden", () => {
		expect(parseHiddenModels("{not json")).toEqual([]);
		expect(parseHiddenModels('{"provider":"openai"}')).toEqual([]);
		expect(parseHiddenModels(null)).toEqual([]);
	});

	test("browser keys are host-qualified", () => {
		expect(hiddenModelsStorageKey("http://localhost:31415")).toBe(
			`${STORAGE_PREFIX}hidden-models:http://localhost:31415`,
		);
	});
});

describe("initModelVisibilityPersistence with the stable adapter", () => {
	test("hydrates the store and writes every change back", () => {
		const { adapter, values } = memoryAdapter({
			[HIDDEN_MODELS_PREFERENCE_KEY]: JSON.stringify([GPT]),
		});
		const dispose = initModelVisibilityPersistence(adapter);
		try {
			expect(useAppStore.getState().hiddenModels).toEqual([GPT]);
			useAppStore.getState().setModelVisibility(OPUS, false);
			expect(JSON.parse(values.get(HIDDEN_MODELS_PREFERENCE_KEY) ?? "")).toEqual([GPT, OPUS]);
			useAppStore.getState().setModelVisibility(GPT, true);
			useAppStore.getState().setModelVisibility(OPUS, true);
			expect(values.has(HIDDEN_MODELS_PREFERENCE_KEY)).toBe(false);
		} finally {
			dispose();
		}
	});

	test("bad stored JSON hydrates as nothing hidden", () => {
		const { adapter } = memoryAdapter({ [HIDDEN_MODELS_PREFERENCE_KEY]: "[{" });
		useAppStore.getState().hydrateHiddenModels([GPT]);
		const dispose = initModelVisibilityPersistence(adapter);
		try {
			expect(useAppStore.getState().hiddenModels).toEqual([]);
		} finally {
			dispose();
		}
	});

	test("a throwing adapter never breaks startup or later changes", () => {
		const dispose = initModelVisibilityPersistence(throwing);
		try {
			expect(useAppStore.getState().hiddenModels).toEqual([]);
			expect(() => useAppStore.getState().setModelVisibility(GPT, false)).not.toThrow();
			expect(useAppStore.getState().hiddenModels).toEqual([GPT]);
		} finally {
			dispose();
		}
	});

	test("stops writing after dispose", () => {
		const { adapter, values } = memoryAdapter();
		initModelVisibilityPersistence(adapter)();
		useAppStore.getState().setModelVisibility(GPT, false);
		expect(values.size).toBe(0);
	});
});

describe("initModelVisibilityPersistence with browser storage", () => {
	test("hydrates from the host-qualified key and syncs other tabs through storage events", () => {
		const { adapter, values } = memoryAdapter();
		const storage = adapter as Storage;
		const browser = fakeBrowser(storage);
		values.set(browser.target.key, JSON.stringify([OPUS]));
		const dispose = initModelVisibilityPersistence(null, () => browser.target);
		try {
			expect(useAppStore.getState().hiddenModels).toEqual([OPUS]);

			values.set(browser.target.key, JSON.stringify([GPT]));
			browser.dispatch({
				key: browser.target.key,
				newValue: JSON.stringify([GPT]),
				storageArea: storage,
			});
			expect(useAppStore.getState().hiddenModels).toEqual([GPT]);

			browser.dispatch({ key: "other", newValue: "[]", storageArea: storage });
			expect(useAppStore.getState().hiddenModels).toEqual([GPT]);

			browser.dispatch({ key: null, newValue: null, storageArea: storage });
			expect(useAppStore.getState().hiddenModels).toEqual([]);
			expect(values.get(browser.target.key)).toBe(JSON.stringify([GPT]));

			useAppStore.getState().setModelVisibility(OPUS, false);
			expect(values.get(browser.target.key)).toBe(JSON.stringify([OPUS]));
		} finally {
			dispose();
		}
		expect(browser.listeners.size).toBe(0);
	});

	test("unavailable browser storage leaves the preference in memory", () => {
		const dispose = initModelVisibilityPersistence(null, () => null);
		try {
			useAppStore.getState().setModelVisibility(GPT, false);
			expect(useAppStore.getState().hiddenModels).toEqual([GPT]);
		} finally {
			dispose();
		}
	});

	test("startup without a window or transport never throws", () => {
		let dispose = () => {};
		expect(() => {
			dispose = initModelVisibilityPersistence(null);
		}).not.toThrow();
		dispose();
	});

	test("storage events filter by key and storage area", () => {
		const storage = {} as Storage;
		const key = hiddenModelsStorageKey("http://localhost:31415");
		expect(
			hiddenModelsFromStorageEvent(
				{ key, newValue: JSON.stringify([GPT]), storageArea: storage },
				storage,
				key,
			),
		).toEqual([GPT]);
		expect(
			hiddenModelsFromStorageEvent(
				{ key, newValue: JSON.stringify([GPT]), storageArea: {} as Storage },
				storage,
				key,
			),
		).toBeUndefined();
		expect(
			hiddenModelsFromStorageEvent({ key, newValue: "nope", storageArea: storage }, storage, key),
		).toEqual([]);
	});
});
