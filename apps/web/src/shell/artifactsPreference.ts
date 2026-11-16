import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { isRecord } from "../lib";
import { type ArtifactsView, useAppStore } from "../store";
import { preferenceStorage, readPreference, writePreference } from "./preferenceStorage";

const SEEN_KEY = "artifacts-seen";
const SHOW_IGNORED_KEY = "artifacts-show-ignored";
const VIEW_KEY = "artifacts-view";
const SMART_KEY = "artifacts-smart";
const TREE_EXPANDED_KEY = "artifacts-tree-expanded";
const MAX_EXPANDED_PATHS = 5000;

function parseRecord(raw: string | null): Record<string, unknown> {
	if (!raw) return {};
	try {
		const value: unknown = JSON.parse(raw);
		return isRecord(value) ? value : {};
	} catch {
		return {};
	}
}

function parseSeen(raw: string | null): Record<string, number> {
	return Object.fromEntries(
		Object.entries(parseRecord(raw)).filter(
			(entry): entry is [string, number] =>
				typeof entry[1] === "number" && Number.isFinite(entry[1]),
		),
	);
}

function parseTreeExpanded(raw: string | null): Record<string, readonly string[]> {
	const expanded: Record<string, readonly string[]> = {};
	for (const [workspaceId, paths] of Object.entries(parseRecord(raw))) {
		if (!Array.isArray(paths)) continue;
		const valid = paths
			.filter((path): path is string => typeof path === "string")
			.slice(0, MAX_EXPANDED_PATHS);
		if (valid.length > 0) expanded[workspaceId] = valid;
	}
	return expanded;
}

function parseView(raw: string | null): ArtifactsView | null {
	return raw === "list" || raw === "tree" || raw === "smart" ? raw : null;
}

export function initArtifactsPersistence(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): () => void {
	const storage = preferenceStorage(stablePreferences);
	useAppStore.getState().hydrateArtifactsPreferences({
		seen: parseSeen(readPreference(storage, SEEN_KEY)),
		showIgnored: readPreference(storage, SHOW_IGNORED_KEY) !== "false",
		view: parseView(readPreference(storage, VIEW_KEY)),
		smart: readPreference(storage, SMART_KEY) !== "false",
		treeExpanded: parseTreeExpanded(readPreference(storage, TREE_EXPANDED_KEY)),
	});
	return useAppStore.subscribe((state, previous) => {
		if (state.artifactsSeenByWorkspace !== previous.artifactsSeenByWorkspace)
			writePreference(storage, SEEN_KEY, JSON.stringify(state.artifactsSeenByWorkspace));
		if (state.artifactsShowIgnored !== previous.artifactsShowIgnored)
			writePreference(storage, SHOW_IGNORED_KEY, String(state.artifactsShowIgnored));
		if (state.artifactsView !== previous.artifactsView && state.artifactsView)
			writePreference(storage, VIEW_KEY, state.artifactsView);
		if (state.artifactsSmart !== previous.artifactsSmart)
			writePreference(storage, SMART_KEY, String(state.artifactsSmart));
		if (state.artifactsTreeExpandedByWorkspace !== previous.artifactsTreeExpandedByWorkspace)
			writePreference(
				storage,
				TREE_EXPANDED_KEY,
				JSON.stringify(state.artifactsTreeExpandedByWorkspace),
			);
	});
}
