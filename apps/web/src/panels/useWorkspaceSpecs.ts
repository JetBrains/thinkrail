import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

/**
 * Own the active workspace's `spec.graph` snapshot in the store: read it on workspace change, re-read on the
 * workspace's fs tick (the host's debounced `workspace.fsChanged` nudge) and on an explicit `refreshToken`
 * bump (the panel header's Refresh — the escape hatch if the watcher degraded).
 *
 * It lives in a hook called by the always-mounted `RightPanel`, NOT inside `SpecsPanel`, because the
 * snapshot is app-wide: the chat's turn divider classifies a round's written files as specs with it
 * (`specPathMatcher`). `SpecsPanel` only exists while its tab is showing, so owning the read there would
 * mean a user sitting on Changes silently un-teaches the chat what a spec is — and every spec the agent
 * writes gets counted as a changed file, deep-linking to the git view that cannot show a gitignored one.
 * That is the exact bug the specs/changes split exists to fix, so the fetch has to outlive the tab.
 *
 * Returns whether **this** workspace's read failed — scoped to the id, so a failure can never leak a
 * "couldn't load" hint over a sibling workspace's tree. A failed re-read keeps the last good snapshot; the
 * caller shows the hint only when there is nothing to show.
 */
export function useWorkspaceSpecs(workspaceId: string | null, refreshToken = 0): boolean {
	const [failedFor, setFailedFor] = useState<string | null>(null);
	const fsTick = useAppStore(
		(s) => (workspaceId ? s.fsChangesByWorkspace[workspaceId]?.tick : 0) ?? 0,
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: fsTick + refreshToken are refetch triggers, not body inputs
	useEffect(() => {
		if (!workspaceId) return;
		let cancelled = false;
		getTransport()
			.request("spec.graph", { workspaceId })
			.then((result) => {
				if (cancelled) return;
				useAppStore.getState().setWorkspaceSpecs(workspaceId, result.nodes);
				setFailedFor(null);
			})
			.catch(() => {
				if (!cancelled) setFailedFor(workspaceId);
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, fsTick, refreshToken]);

	return failedFor !== null && failedFor === workspaceId;
}
