import { type LayoutAttention, readLayoutSelection } from "../../lib";
import { collectAllGroups } from "./model";
import type { LayoutTab, WorkspaceLayoutDocument } from "./types";

export function closeRequestTarget(
	document: WorkspaceLayoutDocument,
	attention: LayoutAttention,
	focusedGroupId: string | undefined,
): LayoutTab | null {
	const groupId = focusedGroupId ?? attention.lastFocusedCenterGroupId;
	const group = collectAllGroups(document).find(
		(candidate) => candidate.location.groupId === groupId,
	);
	if (!group || group.folded) return null;
	if (group.location.area !== "center" && !document[group.location.area].visible) return null;
	const selectedId = readLayoutSelection(attention, groupId);
	const tab = group.tabs.find((candidate) => candidate.id === selectedId) ?? group.tabs[0];
	return tab && tab.kind !== "tool" ? tab : null;
}
