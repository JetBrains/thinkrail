import { useState } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { useWorkspaceRead } from "./useWorkspaceRead";

/**
 * Own the active workspace's `spec.graph` snapshot in the store, kept current by `useWorkspaceRead` (so the
 * re-read triggers and the stale-response guard are the shared ones, not a third copy).
 *
 * It lives in a hook called by `WorkspaceWorkbench`, NOT inside `SpecsPanel`, because the snapshot is
 * app-wide: the chat's turn divider classifies a round's written files as specs with it
 * (`specPathMatcher`). `SpecsPanel` only exists while its tab is showing, so owning the read there would
 * mean a user sitting on Changes silently un-teaches the chat what a spec is — and every spec the agent
 * writes gets counted as a changed file, deep-linking to the git view that cannot show a gitignored one.
 * That is the exact bug the specs/changes split exists to fix, so the fetch has to outlive the tab.
 *
 * Returns whether **this** workspace's read failed — scoped to the id, so a failure can never leak a
 * "couldn't load" hint over a sibling workspace's tree — plus the `reload` behind the panel header's
 * Refresh. A failed re-read keeps the last good snapshot (the store holds it per workspace, so there is
 * nothing to reset on a switch); the caller shows the hint only when there is nothing to show.
 */
export function useWorkspaceSpecs(workspaceId: string | null): {
	failed: boolean;
	reload: () => void;
} {
	const [failedFor, setFailedFor] = useState<string | null>(null);

	const { reload } = useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("spec.graph", { workspaceId: id }),
		{
			onResult: (result, id) => {
				useAppStore.getState().setWorkspaceSpecs(id, result.nodes);
				setFailedFor(null);
			},
			onFailure: (id) => setFailedFor(id),
		},
	);

	return { failed: failedFor !== null && failedFor === workspaceId, reload };
}
