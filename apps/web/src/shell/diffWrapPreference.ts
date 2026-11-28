import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { useAppStore } from "../store";
import { preferenceStorage, readPreference, writePreference } from "./preferenceStorage";

const KEY = "diff-wrap-lines";

export function initDiffWrapPersistence(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): () => void {
	const storage = preferenceStorage(stablePreferences);
	useAppStore.getState().setDiffWrapLines(readPreference(storage, KEY) === "true");
	return useAppStore.subscribe((state, previous) => {
		if (state.diffWrapLines !== previous.diffWrapLines)
			writePreference(storage, KEY, String(state.diffWrapLines));
	});
}
