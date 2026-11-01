import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import {
	EMPTY_LEARNING,
	type LearningSnapshot,
	parseLearning,
	serializeLearning,
} from "./learning";

export const DOUBLE_SHIFT_PREFERENCE_KEY = "search-double-shift";
export const PREVIEW_PREFERENCE_KEY = "search-preview";
export const LEARNING_PREFERENCE_KEY = "search-learning";

interface PreferenceStore {
	read(key: string): string | null;
	write(key: string, value: string): void;
}

function browserStore(httpBase: string): PreferenceStore {
	let storage: Storage | null = null;
	try {
		storage = window.localStorage;
	} catch {}
	return {
		read: (key) => {
			try {
				return storage?.getItem(`${STORAGE_PREFIX}${key}:${httpBase}`) ?? null;
			} catch {
				return null;
			}
		},
		write: (key, value) => {
			try {
				storage?.setItem(`${STORAGE_PREFIX}${key}:${httpBase}`, value);
			} catch {}
		},
	};
}

function stableStore(adapter: StablePreferenceAdapter): PreferenceStore {
	return {
		read: (key) => {
			try {
				return adapter.getItem(key);
			} catch {
				return null;
			}
		},
		write: (key, value) => {
			try {
				adapter.setItem(key, value);
			} catch {}
		},
	};
}

let store: PreferenceStore | null = null;
let learning: LearningSnapshot = EMPTY_LEARNING;
let previewOpen = false;

function preferenceStore(): PreferenceStore {
	if (!store) {
		const stable = getStablePreferenceAdapter();
		store = stable ? stableStore(stable) : browserStore(getTransport().httpBase());
	}
	return store;
}

export function initSearchPreferences(): () => void {
	const preferences = preferenceStore();
	learning = parseLearning(preferences.read(LEARNING_PREFERENCE_KEY), Date.now());
	previewOpen = preferences.read(PREVIEW_PREFERENCE_KEY) === "1";
	const storedDoubleShift = preferences.read(DOUBLE_SHIFT_PREFERENCE_KEY);
	useAppStore.getState().setDoubleShiftSearch(storedDoubleShift !== "0");
	let previous = useAppStore.getState().doubleShiftSearch;
	return useAppStore.subscribe((state) => {
		if (state.doubleShiftSearch === previous) return;
		previous = state.doubleShiftSearch;
		preferences.write(DOUBLE_SHIFT_PREFERENCE_KEY, previous ? "1" : "0");
	});
}

export function readLearning(): LearningSnapshot {
	return learning;
}

export function writeLearning(next: LearningSnapshot): void {
	learning = next;
	preferenceStore().write(LEARNING_PREFERENCE_KEY, serializeLearning(next));
}

export function readPreviewOpen(): boolean {
	return previewOpen;
}

export function writePreviewOpen(open: boolean): void {
	previewOpen = open;
	preferenceStore().write(PREVIEW_PREFERENCE_KEY, open ? "1" : "0");
}
