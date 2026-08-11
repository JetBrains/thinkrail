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
	// Three distinct states, never two: `null` = **never answered** (loading), `error` = the read *failed* and
	// there is no list to show, and a `GitStatus` = an answer — whose empty `changes` is the only thing allowed
	// to render as "no changes". Collapsing the first two into an empty status is how a review surface ends up
	// telling the user a dirty worktree is clean.
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
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
	// failure (timeout, prolonged network outage, git error) must leave the chosen scope alone — hence the code,
	// not just "the read failed".
	const { reload } = useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("git.status", { workspaceId: id, scope }),
		{
			onResult: (result) => {
				setStatus(result);
				setError(null);
				warnedRef.current = false;
			},
			onFailure: (_id, failure) => {
				if (wsErrorCode(failure) === "UNKNOWN_COMMIT") {
					setDiffScope(workspaceId, { kind: "branch" });
					toast.info("That commit is no longer in this branch — showing all changes.");
					return;
				}
				// Keep the last good list — but say so once per failing streak, so a stale list is never silently
				// passed off as current.
				if (status && !warnedRef.current) {
					warnedRef.current = true;
					toast.error(`Could not refresh the changes: ${errorText(failure)}`);
				}
				// Nothing to keep (a first, failed read) → the failure itself is what the panel shows. It must never
				// degrade to an empty change set: "clean" is a claim, and this read didn't make it.
				setError(errorText(failure));
			},
			onSwitch: () => {
				setStatus(null);
				setError(null);
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
				// The toolbar holds the scope selector and the target-branch picker as well as the List|Tree
				// segments, so it is named for what it is, not for the one control it used to hold.
				aria-label="Changes scope and view"
				className="flex h-panel-header-row shrink-0 items-center gap-xs overflow-clip border-border-default border-b bg-container-header-bg px-sm"
			>
				<div className="mr-auto flex min-w-0 items-center gap-xs">
					{/* Keyed ON PURPOSE (do not "clean up") by the menu's full identity — workspace **and** target ref:
					    the panel is not remounted on a workspace switch, and the commit rows are `git log <base>..HEAD`,
					    so re-pointing the target changes which commits exist. The remount clears rows that belonged to
					    the previous (workspace, base) and neutralizes a response still in flight for it. */}
					<ChangesScopeMenu
						key={`${workspaceId}:${baseRef}`}
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
							triggerClassName="flex h-6 min-w-0 max-w-[200px] items-center gap-xs rounded-[var(--radius-sm)] px-xs outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-selected"
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
				{status === null && error !== null ? (
					<div data-testid="changes-error" className="flex flex-col items-start gap-xs px-sm py-xs">
						<p className="tr-text-metadata text-feedback-error">
							Could not read the changes: {error}
						</p>
						<button
							type="button"
							data-testid="changes-retry"
							onClick={reload}
							className="rounded-[var(--radius-sm)] px-xs py-[2px] tr-text-metadata text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
						>
							Retry
						</button>
					</div>
				) : status === null ? (
					<p className="px-sm py-xs tr-text-metadata text-text-muted">Loading…</p>
				) : status.changes.length === 0 ? (
					<p data-testid="changes-empty" className="px-sm py-xs tr-text-metadata text-text-muted">
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
												// No background of its own: the WRAPPER paints the row's hover/selected band, which has
												// to span the trailing ⌄ slot too. Two painters would make the row read as cut off at
												// this button's edge (and hide that the wrapper stopped painting).
												className="flex min-w-0 flex-1 items-center gap-sm px-sm py-xs text-left tr-text-ui"
											>
												{/* The full relative path: a muted directory prefix, a bright basename — and the dir
												    yields **completely** before the basename gives up a pixel, because the name is what
												    a user scans. That ordering is structural, not a ratio: the dir is the only shrinkable
												    item, so it absorbs the entire deficit, down to zero width if the name needs the whole
												    row. (A shrink *ratio* — this was `shrink-[20]` vs `shrink` — only approximates it:
												    flex splits the deficit in proportion to factor × basis, so the basename always loses a
												    slice. That slice was sub-pixel at the old type scale and ~2px at 14px, which is how a
												    12-character `shortName.ts` started rendering with an ellipsis.) */}
												<span className="flex min-w-0 flex-1 items-baseline">
													{dir ? (
														<span
															data-testid="change-path-dir"
															className="min-w-0 shrink truncate text-text-muted"
														>
															{dir}
														</span>
													) : null}
													{/* `shrink-0` **plus** `max-w-full`: flex never steals width from the name, but
													    max-width still clamps it to the row, so a long ROOT-level basename (no dir prefix
													    to absorb anything) truncates instead of pushing the +/− badge out of the panel —
													    the same rule DiffPane's header chip follows. */}
													<span
														data-testid="change-path-base"
														className={`max-w-full shrink-0 truncate ${statusNameClass(change.status) || "text-text-muted"}`}
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
