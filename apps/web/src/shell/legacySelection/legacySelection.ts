import { useEffect, useRef } from "react";
import {
	selectAttentionCenterResourceCacheKey,
	selectAttentionCenterTab,
	useAppStore,
} from "../../store";
import type { LayoutCenterTab } from "../layout";

function syncLegacySelectedResource(
	workspaceId: string,
	tab: LayoutCenterTab | null,
	cacheKey: string | null,
): void {
	const state = useAppStore.getState();
	if (!tab) {
		state.syncLegacySelection(workspaceId, null);
		return;
	}
	if (tab.kind === "terminal") {
		state.syncLegacySelection(
			workspaceId,
			cacheKey === tab.tabKey ? { kind: "terminal", tabKey: tab.tabKey } : null,
		);
		return;
	}
	const cache = cacheKey
		? state.tabsByWorkspace[workspaceId]?.find((candidate) => candidate.id === cacheKey)
		: undefined;
	state.syncLegacySelection(workspaceId, cache ? { kind: "editor", tabId: cache.id } : null);
}

export function syncLegacySelectionFromAttention(workspaceId: string): void {
	const state = useAppStore.getState();
	syncLegacySelectedResource(
		workspaceId,
		selectAttentionCenterTab(state, workspaceId),
		selectAttentionCenterResourceCacheKey(state, workspaceId),
	);
}

export function useLegacySelectionAdapter(
	workspaceId: string,
	activeReviewedPath: string | null,
	readActiveReviewedPath: () => string | null,
): void {
	const selectedCenterTab = useAppStore((state) => selectAttentionCenterTab(state, workspaceId));
	const selectedCenterResourceCacheKey = useAppStore((state) =>
		selectAttentionCenterResourceCacheKey(state, workspaceId),
	);
	const activeLegacyTabId = useAppStore((state) => state.activeTabByWorkspace[workspaceId] ?? null);
	const previousReviewedSelection = useRef<string | null>(null);

	useEffect(() => {
		const reviewedSelection =
			activeLegacyTabId && activeReviewedPath
				? JSON.stringify([activeLegacyTabId, activeReviewedPath])
				: null;
		const previous = previousReviewedSelection.current;
		previousReviewedSelection.current = reviewedSelection;
		if (!reviewedSelection || reviewedSelection === previous) return;
		const state = useAppStore.getState();
		const currentActiveTabId = state.activeTabByWorkspace[workspaceId];
		const currentReviewedPath = readActiveReviewedPath();
		const currentReviewedSelection =
			currentActiveTabId && currentReviewedPath
				? JSON.stringify([currentActiveTabId, currentReviewedPath])
				: null;
		if (currentReviewedSelection !== reviewedSelection) return;
		state.enqueueLayoutIntent({ kind: "reveal-tool", workspaceId, tool: "review" });
	}, [activeLegacyTabId, activeReviewedPath, readActiveReviewedPath, workspaceId]);

	useEffect(() => {
		syncLegacySelectedResource(workspaceId, selectedCenterTab, selectedCenterResourceCacheKey);
	}, [selectedCenterResourceCacheKey, selectedCenterTab, workspaceId]);
}
