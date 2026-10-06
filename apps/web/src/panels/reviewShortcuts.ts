import { hasLayer, isTextEntryTarget, layoutResourceIdentity, MODAL_LAYER_SELECTOR } from "@/lib";
import { type ChangesTab, selectAttentionCenterTab, useAppStore } from "../store";

export function ownsReviewShortcut(
	event: KeyboardEvent,
	tab: ChangesTab,
	doc: Pick<Document, "querySelector"> = document,
): boolean {
	if (isTextEntryTarget(event.target) || hasLayer(doc, MODAL_LAYER_SELECTOR)) return false;
	const selected = selectAttentionCenterTab(useAppStore.getState(), tab.workspaceId);
	return (
		selected?.kind === "changes" && layoutResourceIdentity(selected) === layoutResourceIdentity(tab)
	);
}
