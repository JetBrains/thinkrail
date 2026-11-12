import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import { type ModelRef, useAppStore } from "../store";
import { getTransport } from "../transport";

export const HIDDEN_MODELS_PREFERENCE_KEY = "hidden-models";

export interface BrowserPreferenceTarget {
	storage: Storage;
	key: string;
	events: Pick<Window, "addEventListener" | "removeEventListener">;
}

export function hiddenModelsStorageKey(httpBase: string): string {
	return `${STORAGE_PREFIX}hidden-models:${httpBase}`;
}

function isModelRef(value: unknown): value is ModelRef {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof Reflect.get(value, "provider") === "string" &&
		typeof Reflect.get(value, "id") === "string"
	);
}

export function parseHiddenModels(value: string | null): ModelRef[] {
	if (value === null) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(isModelRef).map((model) => ({ provider: model.provider, id: model.id }));
}

function readHiddenModels(storage: StablePreferenceAdapter, key: string): ModelRef[] {
	try {
		return parseHiddenModels(storage.getItem(key));
	} catch {
		return [];
	}
}

function writeHiddenModels(
	storage: StablePreferenceAdapter,
	key: string,
	hidden: readonly ModelRef[],
): void {
	try {
		if (hidden.length === 0) storage.removeItem(key);
		else storage.setItem(key, JSON.stringify(hidden));
	} catch {}
}

export function hiddenModelsFromStorageEvent(
	event: Pick<StorageEvent, "key" | "newValue" | "storageArea">,
	storage: Storage,
	key: string,
): ModelRef[] | undefined {
	if (
		(event.key !== null && event.key !== key) ||
		(event.storageArea !== null && event.storageArea !== storage)
	) {
		return undefined;
	}
	return event.key === null ? [] : parseHiddenModels(event.newValue);
}

function browserPreferenceTarget(): BrowserPreferenceTarget | null {
	try {
		return {
			storage: window.localStorage,
			key: hiddenModelsStorageKey(getTransport().httpBase()),
			events: window,
		};
	} catch {
		return null;
	}
}

export function initModelVisibilityPersistence(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
	browserTarget: () => BrowserPreferenceTarget | null = browserPreferenceTarget,
): () => void {
	const browser = stablePreferences ? null : browserTarget();
	const storage = stablePreferences ?? browser?.storage ?? null;
	const key = stablePreferences ? HIDDEN_MODELS_PREFERENCE_KEY : (browser?.key ?? "");
	const initial = storage ? readHiddenModels(storage, key) : [];
	useAppStore.getState().hydrateHiddenModels(initial);
	let previous = useAppStore.getState().hiddenModels;
	const unsubscribe = useAppStore.subscribe((state) => {
		if (state.hiddenModels === previous) return;
		previous = state.hiddenModels;
		if (storage) writeHiddenModels(storage, key, previous);
	});
	const onStorage = (event: StorageEvent) => {
		if (!browser) return;
		const hidden = hiddenModelsFromStorageEvent(event, browser.storage, browser.key);
		if (hidden === undefined) return;
		previous = hidden;
		useAppStore.getState().hydrateHiddenModels(hidden);
	};
	browser?.events.addEventListener("storage", onStorage);
	return () => {
		unsubscribe();
		browser?.events.removeEventListener("storage", onStorage);
	};
}
