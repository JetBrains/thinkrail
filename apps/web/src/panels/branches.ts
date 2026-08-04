import type { BranchList } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { getTransport } from "../transport";

/**
 * What an unanswerable branch list degrades to: no branches, and **no default** — deliberately the empty
 * string rather than the literal `"HEAD"`. A sentinel that named a ref would be *believed*: the
 * New-Workspace dialog would preselect it and persist it as the new workspace's `baseBranch`, and every
 * later diff would measure that worktree against its own head ("All changes" silently collapsing to
 * uncommitted-only). An empty default means "we don't know", so the dialog sends no `baseRef` and the host
 * resolves the real branch (see `resolveDefaultBranch`).
 */
const NO_BRANCHES: BranchList = { local: [], remote: [], defaultBranch: "" };

/**
 * A project's branches for a picker, **offline-degrading**: a failed read answers an empty list rather than
 * rejecting, because every caller wants "show what git could answer" (the base picker still lets a user
 * proceed; the Changes scope menu still offers its other scopes). One helper so the degradation is defined
 * once for both pickers. Module-private: every consumer goes through {@link useBranchList}, so the
 * surrounding state (project keying, refresh, spinner) can't be re-implemented per picker.
 */
async function listBranchesOrEmpty(projectId: string): Promise<BranchList> {
	try {
		return await getTransport().request("git.listBranches", { projectId });
	} catch {
		return NO_BRANCHES;
	}
}

/**
 * The state *around* a {@link BranchPicker} — the list, whether a manual refresh is in flight, and the
 * refresh itself — so the app's two pickers (the New-Workspace *base* and the Changes *target*) behave
 * identically by construction rather than by two copies of the same effect:
 *
 * - **keyed to the project**: the list clears when `projectId` changes, so a switch can never offer the
 *   previous project's branches, and both reads are generation-stamped so a response in flight when the
 *   project moved on stays silent;
 * - **only the initial read degrades** (`listBranchesOrEmpty`): a *refresh* has a good list to keep, so a
 *   transient failure leaves it on screen instead of blanking the picker;
 * - `refreshing` drives the picker's spinner, so a refresh is never a silent no-visible-change click.
 *
 * A `null` projectId reads nothing — which is how a closed dialog pauses its read.
 * `onLoaded` fires for the **initial** read only (never a refresh), for a caller that derives state from
 * the first answer (the dialog's preselected base + its background prefetch) without a refresh clobbering
 * the user's own pick.
 */
export function useBranchList(
	projectId: string | null,
	onLoaded?: (list: BranchList) => void,
): { branches: BranchList | null; refreshing: boolean; refresh: () => void } {
	const [branches, setBranches] = useState<BranchList | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const latestOnLoaded = useRef(onLoaded);
	latestOnLoaded.current = onLoaded;
	// Stamps each read; a newer read — or a project change/unmount — invalidates the ones before it (the
	// same discipline as `useWorkspaceRead`, without the fs tick).
	const generation = useRef(0);

	useEffect(() => {
		const mine = ++generation.current;
		setBranches(null);
		setRefreshing(false);
		if (!projectId) return;
		void listBranchesOrEmpty(projectId).then((list) => {
			if (generation.current !== mine) return;
			setBranches(list);
			latestOnLoaded.current?.(list);
		});
		return () => {
			generation.current += 1; // abandon this project's in-flight read
		};
	}, [projectId]);

	const refresh = useCallback(() => {
		if (!projectId) return;
		const mine = ++generation.current;
		setRefreshing(true);
		getTransport()
			.request("git.listBranches", { projectId })
			.then((list) => {
				if (generation.current === mine) setBranches(list);
			})
			// Keep the current list on failure — unlike the initial read, there IS a list to keep.
			.catch(() => {})
			.finally(() => {
				if (generation.current === mine) setRefreshing(false);
			});
	}, [projectId]);

	return { branches, refreshing, refresh };
}
