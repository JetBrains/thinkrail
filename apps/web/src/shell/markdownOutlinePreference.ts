import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

const VISIBLE_KEY = "markdown-outline-visible";
const SIDE_KEY = "markdown-outline-side";

interface PreferenceStorage {
	read(key: string): string | null;
	write(key: string, value: string): void;
}

function preferenceStorage(stable: StablePreferenceAdapter | null): PreferenceStorage {
	if (stable) {
		return {
			read: (key) => stable.getItem(key),
			write: (key, value) => stable.setItem(key, value),
		};
	}
	const httpBase = getTransport().httpBase();
	return {
		read: (key) => window.localStorage.getItem(`${STORAGE_PREFIX}${key}:${httpBase}`),
		write: (key, value) =>
			window.localStorage.setItem(`${STORAGE_PREFIX}${key}:${httpBase}`, value),
	};
}

function read(storage: PreferenceStorage, key: string): string | null {
	try {
		return storage.read(key);
	} catch {
		return null;
	}
}

function write(storage: PreferenceStorage, key: string, value: string): void {
	try {
		storage.write(key, value);
	} catch {}
}

export function initMarkdownOutlinePersistence(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): () => void {
	const storage = preferenceStorage(stablePreferences);
	const store = useAppStore.getState();
	const visible = read(storage, VISIBLE_KEY);
	if (visible === "true" || visible === "false")
		store.setMarkdownOutlineVisible(visible === "true");
	store.setMarkdownOutlineSide(read(storage, SIDE_KEY) === "left" ? "left" : "right");
	return useAppStore.subscribe((state, previous) => {
		if (
			state.markdownOutlineVisible !== null &&
			state.markdownOutlineVisible !== previous.markdownOutlineVisible
		)
			write(storage, VISIBLE_KEY, String(state.markdownOutlineVisible));
		if (state.markdownOutlineSide !== previous.markdownOutlineSide)
			write(storage, SIDE_KEY, state.markdownOutlineSide);
	});
}
