import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { useAppStore } from "../store";
import { preferenceStorage, readPreference, writePreference } from "./preferenceStorage";

const NEON_KEY = "neon-glow";

export function applyNeonGlow(enabled: boolean): void {
	if (typeof document === "undefined") return;
	document.documentElement.dataset.heliosNeon = String(enabled);
}

export function initNeonGlowPersistence(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): () => void {
	const storage = preferenceStorage(stablePreferences);
	useAppStore.getState().setNeonGlow(readPreference(storage, NEON_KEY) !== "false");
	applyNeonGlow(useAppStore.getState().neonGlow);
	return useAppStore.subscribe((state, previous) => {
		if (state.neonGlow === previous.neonGlow) return;
		applyNeonGlow(state.neonGlow);
		writePreference(storage, NEON_KEY, String(state.neonGlow));
	});
}
