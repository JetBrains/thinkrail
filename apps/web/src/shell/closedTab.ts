import { layoutResourceIdentity } from "../lib";
import { useAppStore } from "../store";
import type { LayoutTab } from "./layout";
import { toLayoutTab } from "./layoutIntents";

/** What a committed close lets go of: a chat goes to history, a resource tab its cache, an extension tab its view state. */
export function releaseClosedTab(workspaceId: string, tab: LayoutTab): void {
	const state = useAppStore.getState();
	if (tab.kind === "chat") {
		state.closeChatToHistory(tab.sessionId, false, workspaceId, false);
		return;
	}
	if (
		tab.kind !== "file" &&
		tab.kind !== "diff" &&
		tab.kind !== "changes" &&
		tab.kind !== "document" &&
		tab.kind !== "extension"
	) {
		return;
	}
	const identity = layoutResourceIdentity(tab);
	for (const cache of state.tabsByWorkspace[workspaceId] ?? []) {
		const resource = toLayoutTab(cache);
		if (resource && layoutResourceIdentity(resource) === identity) {
			state.closeTab(cache.id, false, false, workspaceId);
		}
	}
	if (tab.kind === "extension") state.dropPanelViewState(workspaceId, identity);
}
