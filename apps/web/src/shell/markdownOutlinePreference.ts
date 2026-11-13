import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { useAppStore } from "../store";
import { preferenceStorage, readPreference, writePreference } from "./preferenceStorage";

const VISIBLE_KEY = "markdown-outline-visible";
const SIDE_KEY = "markdown-outline-side";

export function initMarkdownOutlinePersistence(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): () => void {
	const storage = preferenceStorage(stablePreferences);
	const store = useAppStore.getState();
	const visible = readPreference(storage, VISIBLE_KEY);
	if (visible === "true" || visible === "false")
		store.setMarkdownOutlineVisible(visible === "true");
	store.setMarkdownOutlineSide(readPreference(storage, SIDE_KEY) === "left" ? "left" : "right");
	return useAppStore.subscribe((state, previous) => {
		if (
			state.markdownOutlineVisible !== null &&
			state.markdownOutlineVisible !== previous.markdownOutlineVisible
		)
			writePreference(storage, VISIBLE_KEY, String(state.markdownOutlineVisible));
		if (state.markdownOutlineSide !== previous.markdownOutlineSide)
			writePreference(storage, SIDE_KEY, state.markdownOutlineSide);
	});
}
