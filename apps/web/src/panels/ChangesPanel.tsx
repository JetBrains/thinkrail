import type { GitStatus } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	matchesWorktreePath,
	selectDiffBaseRef,
	selectDiffScope,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	type TabIntent,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { BranchPicker } from "./BranchPicker";
import { useBranchList } from "./branches";
import { ChangeRowActions } from "./ChangeRowActions";
import { ChangesScopeMenu } from "./ChangesScopeMenu";
import { ChangesTree } from "./ChangesTree";
import { diffTabId, isDiffTabId, scopeKey, splitPath, statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { openDiffInTab } from "./openTabs";
import { ToggleSegment } from "./ToggleSegment";
import { useWorkspaceRead } from "./useWorkspaceRead";

/**
 * Changes for the active worktree: a **scope selector** (what is diffed — all changes on the branch, only
 * the uncommitted ones, or a single commit) plus a **target-branch picker** (the ref the branch scope
 * measures against, re-pointable per workspace), over the changed-file list. Clicking a file **previews**
 * (or focuses) its Monaco diff tab in the center and a double click keeps it — so scanning a change set
 * reuses one tab. The diff itself renders there (`DiffPane`), not under the list.
 * Two layouts, switched by the header toggle (`store.changesView`, app-wide): a flat **List** of full
 * relative paths and a folder **Tree** (`ChangesTree`, styled like the All-files tree), both with per-file
 * `+/−` counts and a per-row action menu (`ChangeRowActions`).
 * Live: the store's per-workspace fs tick silently re-reads `git.status`; a scope switch re-reads the same
 * way (it is the read's second identity dimension). The open diff tabs follow the disk on their own
 * (DiffPane's re-read). A chat deep-link highlights its row AND opens the diff tab in the preview slot —
 * the chip/list-row click is the user's explicit ask to see that change. It degrades to highlight-only for
 * a path no longer in the diff, and for one the user has navigated past while the list was still loading
 * (the open loses to the newer navigation, as any pending preview does).
 */
export function ChangesPanel({ workspaceId }: { workspaceId: string }) {
	const [status, setStatus] = useState<GitStatus | null>(null);
	// Whether the current failing streak has already been reported — an fs tick can fail repeatedly, and one
	// toast per tick would bury the user in the same line. Cleared by the next landed read.
	const warnedRef = useRef(false);
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const changesRequest = useAppStore((s) => s.changesRequest);
	const changesView = useAppStore((s) => s.changesView);
	const setChangesView = useAppStore((s) => s.setChangesView);
	const setDiffScope = useAppStore((s) => s.setDiffScope);
	const scope = useAppStore((s) => selectDiffScope(s, workspaceId));
	const workspace = useAppStore((s) => selectWorkspaceById(s, workspaceId));
	// The ref the branch scope measures against, as the host resolves it. Part of what the read *means*, so
	// it joins the scope in the read key: re-pointing the target (which arrives as a `workspace.updated`
	// broadcast, never optimistically) re-reads the list exactly like a scope switch.
	const baseRef = useAppStore((s) => selectDiffBaseRef(s, workspaceId));
	const activeTabId = useAppStore((s) => s.activeTabByWorkspace[workspaceId] ?? null);

	// The changed-file list, re-read on the workspace's fs tick *and* on a scope/target change (the `readKey`); a
	// switch clears the list and its deep-link highlight, a failed re-read keeps the last good list (a failed
	// first read reads as "no changes").
	// One rejection has a *meaning*: `UNKNOWN_COMMIT` — the host naming a commit scope whose commit the repo no
	// longer has (a rebase, a branch reset). That falls back to the branch scope with a toast, so the panel is
	// neither wedged on a dead sha nor silently showing a different scope than the user picked. Every other
	// failure (timeout, dropped socket, git error) must leave the chosen scope alone — hence the code, not just
	// "the read failed".
	useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("git.status", { workspaceId: id, scope }),
		{
			onResult: (result) => {
				setStatus(result);
				warnedRef.current = false;
			},
			onFailure: (_id, error) => {
				if (wsErrorCode(error) === "UNKNOWN_COMMIT") {
					setDiffScope(workspaceId, { kind: "branch" });
					toast.info("That commit is no longer in this branch — showing all changes.");
					return;
				}
				// Keep the last good list — but say so once per failing streak, so a stale list is never silently
				// passed off as current (a first, failed read has nothing to keep and reads as an empty scope).
				if (status && !warnedRef.current) {
					warnedRef.current = true;
					toast.error(`Could not refresh the changes: ${errorText(error)}`);
				}
				setStatus((prev) => prev ?? { branch: "", changes: [] });
			},
			onSwitch: () => {
				setStatus(null);
				setHighlighted(null);
				warnedRef.current = false; // a new workspace/scope is a new streak
			},
		},
		`${scopeKey(scope)}:${baseRef}`,
	);

	// The target-branch list, keyed to the project and refreshable — the same shared hook (and therefore the
	// same degradation) the New-Workspace base picker uses.
	const {
		branches,
		refreshing: branchesRefreshing,
		refresh: refreshBranches,
	} = useBranchList(workspace?.projectId ?? null);

	// Re-point what the changes are measured against. `workspace.setDiffBase` echoes + broadcasts the updated
	// workspace; the list re-reads off that push (the ref is part of this panel's read key).
	const pointAt = async (ref: string) => {
		try {
			await getTransport().request("workspace.setDiffBase", { id: workspaceId, ref });
		} catch (error) {
			toast.error(`Could not change the target branch: ${errorText(error)}`);
		}
	};

	// Open (or focus) the file's Monaco diff tab in the center — one tab per (file, scope); the row lights up
	// either way. Stable per workspace + scope so the deep-link effect below can depend on it without
	// re-firing per render.
	const openDiff = useCallback(
		(path: string, intent: TabIntent) => {
			setHighlighted(path);
			void openDiffInTab(workspaceId, scope, path, intent);
		},
		[workspaceId, scope],
	);

	// A chat deep-link (turn-divider chip / expanded-list row) targeting this workspace: once the status
	// list is loaded, open the file's diff tab (the click was the explicit ask to see the change) — or, when
	// the path is no longer in the current diff (a round from days ago), just highlight where it would be.
	// It opens as a `preview`, like `SpecsPanel`'s chip: following a deep link is browsing, exactly as
	// clicking the row it points at is, so it belongs in the workspace's reusable slot rather than
	// accumulating a kept tab per chip.
	// `matchesWorktreePath` resolves an absolute pi path to its relative entry (the same helper the spec
	// classifier uses). The request is consumed once handled: it opens a center tab, so a replay on the next
	// git-status re-read (this effect keys on `status`) would yank the user's tab back.
	//
	// The open is gated on the nav count stamped when the chip was clicked. Unlike `SpecsPanel`, which opens
	// the reported path straight away, this deep link cannot resolve its path until `git.status` lands — and
	// the chip is usually what reveals this view, so that read is a fresh mount's, not a warm one's. Anything
	// the user does with the center in that window (picking a tab, opening a chat) is the LATER navigation
	// and has to win; without the stamp the arriving open would call itself the navigation and steal focus
	// back. An overtaken deep link degrades to the highlight — the same outcome `openTabs` gives a preview
	// read that lands after the count moved.
	useEffect(() => {
		if (!status || changesRequest?.workspaceId !== workspaceId) return;
		const want = changesRequest.path;
		const match = status.changes.find((c) => matchesWorktreePath(want, c.path));
		const overtaken =
			selectWorkspaceNavTick(useAppStore.getState(), workspaceId) !== changesRequest.navTick;
		if (match && !overtaken) openDiff(match.path, "preview");
		else setHighlighted(match ? match.path : want);
		useAppStore.getState().clearChangesRequest();
	}, [changesRequest, status, workspaceId, openDiff]);

	// Keep the deep-link highlight from lingering once the user starts navigating diff tabs: clear it as
	// soon as a diff tab of this workspace is the active center tab, so closing that tab later doesn't
	// resurrect a stale highlight.
	useEffect(() => {
		if (isDiffTabId(workspaceId, activeTabId)) setHighlighted(null);
	}, [activeTabId, workspaceId]);

	// Exactly one row is ever selected: while a diff tab of this workspace is active, that tab is the sole
	// signal (an active tab matches exactly one path); only when none is open does the deep-link highlight
	// apply. This can't show two rows at once — unlike OR-ing the two signals, where a stale highlight plus
	// a different active tab would both read as selected.
	const isActive = (path: string) =>
		isDiffTabId(workspaceId, activeTabId)
			? activeTabId === diffTabId(workspaceId, scope, path)
			: highlighted === path;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="changes-view-toggle"
				role="toolbar"
				aria-label="Changes view mode"
				className="flex h-8 shrink-0 items-center gap-xs border-border2 border-b bg-bg-dark px-sm"
			>
				<div className="mr-auto flex min-w-0 items-center gap-xs">
					{/* Keyed by workspace ON PURPOSE (do not "clean up"): the panel is not remounted on a workspace
					    switch, and this menu's lazy reads are *open*-triggered, not tick-triggered, so they can't go
					    through `useWorkspaceRead`'s generation stamping. The remount both clears the previous
					    workspace's commit rows and neutralizes a response still in flight for it. */}
					<ChangesScopeMenu
						key={workspaceId}
						workspaceId={workspaceId}
						scope={scope}
						onSelectScope={(next) => setDiffScope(workspaceId, next)}
					/>
					{/* The target branch is re-pointable, and it is a host mutation: the panel converges on the
					    broadcast `workspace.updated` (which moves `baseRef`, hence the read key), never optimistically. */}
					{workspace ? (
						<BranchPicker
							branches={branches}
							selected={baseRef}
							refreshing={branchesRefreshing}
							label="vs"
							testid="changes-target-picker"
							triggerClassName="flex h-6 min-w-0 max-w-[200px] items-center gap-xs rounded-[var(--radius-sm)] px-xs outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-hover"
							onSelect={(ref) => void pointAt(ref)}
							onRefresh={refreshBranches}
						/>
					) : null}
				</div>
				<ToggleSegment
					testid="changes-toggle-list"
					label="List"
					active={changesView === "list"}
					onClick={() => setChangesView("list")}
				/>
				<ToggleSegment
					testid="changes-toggle-tree"
					label="Tree"
					active={changesView === "tree"}
					onClick={() => setChangesView("tree")}
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{status === null ? (
					<p className="px-sm py-xs text-xs text-hint">Loading…</p>
				) : status.changes.length === 0 ? (
					<p data-testid="changes-empty" className="px-sm py-xs text-xs text-hint">
						No changes in this scope.
					</p>
				) : changesView === "tree" ? (
					<ChangesTree changes={status.changes} onOpen={openDiff} isActive={isActive} />
				) : (
					<ul>
						{status.changes.map((change) => {
							const { dir, base } = splitPath(change.path);
							return (
								<li key={change.path}>
									<ChangeRowActions
										path={change.path}
										active={isActive(change.path)}
										onView={() => openDiff(change.path, "preview")}
									>
										{({ onContextMenu }) => (
											<button
												type="button"
												onContextMenu={onContextMenu}
												data-testid="change-item"
												data-status={change.status}
												data-active={isActive(change.path) ? true : undefined}
												onClick={() => openDiff(change.path, "preview")}
												onDoubleClick={() => openDiff(change.path, "keep")}
												title={change.path}
												className={`flex min-w-0 flex-1 items-center gap-sm px-sm py-xs text-left text-sm hover:bg-hover ${
													isActive(change.path) ? "bg-hover" : ""
												}`}
											>
												{/* The full relative path: a muted directory prefix, a bright basename. The dir
											    yields first (`truncate` + `flex-1`), so the name a user scans stays visible. */}
												<span className="flex min-w-0 flex-1 items-baseline">
													{dir ? <span className="min-w-0 truncate text-hint">{dir}</span> : null}
													{/* Truncatable, not `shrink-0`: a long ROOT-level basename has no dir prefix to
													    absorb the overflow, and a row that can't shrink pushes the +/− badge out of
													    the panel — the same rule DiffPane's header chip follows. */}
													<span
														className={`min-w-0 truncate ${statusNameClass(change.status) || "text-muted"}`}
													>
														{base}
													</span>
												</span>
												<DiffStatBadge added={change.added ?? 0} removed={change.removed ?? 0} />
											</button>
										)}
									</ChangeRowActions>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}
