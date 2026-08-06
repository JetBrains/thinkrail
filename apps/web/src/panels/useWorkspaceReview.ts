import { useState } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { useWorkspaceRead } from "./useWorkspaceRead";

/**
 * Owns the `review.get` read for a workspace (the `useWorkspaceSpecs` pattern): the snapshot lands in
 * the store (`reviewsByWorkspace`), not panel state, because review presence is app-wide — the center
 * tab strip's violet `Review` flags and the Review tab's badge need the answer even while the Review
 * panel body is unmounted. Called by `RightPanel` (mounted whenever a workspace is active), NOT by
 * `ReviewPanel`. The read re-anchors server-side, so every fs tick also refreshes anchor states.
 */
export function useWorkspaceReview(workspaceId: string | null): { failed: boolean } {
	const [failed, setFailed] = useState(false);
	useWorkspaceRead(workspaceId, (id) => getTransport().request("review.get", { workspaceId: id }), {
		onResult: (result) => {
			setFailed(false);
			if (workspaceId) useAppStore.getState().setWorkspaceReview(workspaceId, result);
		},
		onFailure: () => setFailed(true),
		onSwitch: () => setFailed(false),
	});
	return { failed };
}
