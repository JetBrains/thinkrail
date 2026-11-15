import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { useAppStore } from "../store";
import { preferenceStorage, readPreference, writePreference } from "./preferenceStorage";

const SEEN_KEY = "artifacts-seen";
const SHOW_IGNORED_KEY = "artifacts-show-ignored";

function parseSeen(raw: string | null): Record<string, number> {
	if (!raw) return {};
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return Object.fromEntries(
			Object.entries(value).filter(
				(entry): entry is [string, number] =>
					typeof entry[1] === "number" && Number.isFinite(entry[1]),
			),
		);
	} catch {
		return {};
	}
}

export function initArtifactsPersistence(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): () => void {
	const storage = preferenceStorage(stablePreferences);
	useAppStore.getState().hydrateArtifactsPreferences({
		seen: parseSeen(readPreference(storage, SEEN_KEY)),
		showIgnored: readPreference(storage, SHOW_IGNORED_KEY) !== "false",
	});
	return useAppStore.subscribe((state, previous) => {
		if (state.artifactsSeenByWorkspace !== previous.artifactsSeenByWorkspace)
			writePreference(storage, SEEN_KEY, JSON.stringify(state.artifactsSeenByWorkspace));
		if (state.artifactsShowIgnored !== previous.artifactsShowIgnored)
			writePreference(storage, SHOW_IGNORED_KEY, String(state.artifactsShowIgnored));
	});
}
