import type { GitStatus } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { matchesWorktreePath, selectWorkspaceNavTick, type TabIntent, useAppStore } from "../store";
import { getTransport } from "../transport";
import { ChangesTree } from "./ChangesTree";
import { diffTabId, isDiffTabId, statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { openDiffInTab } from "./openTabs";
import { ToggleSegment } from "./ToggleSegment";
import { useWorkspaceRead } from "./useWorkspaceRead";

/**
 * Changes for the active worktree: the changed-file list (vs base). Clicking a file **previews** (or
 * focuses) its Monaco diff tab in the center and a double click keeps it — so scanning a change set reuses
 * one tab. The diff itself renders there (`DiffPane`), not under the list.
 * Two layouts, switched by the header toggle (`store.changesView`, app-wide): a flat **List** and a
 * folder **Tree** (`ChangesTree`, styled like the All-files tree, with per-file/-folder `+/−` counts).
 * Live: the store's per-workspace fs tick silently re-reads `git.status`; the open diff tabs follow the
 * disk on their own (DiffPane's re-read). A chat deep-link highlights its row AND opens the diff tab in
 * the preview slot — the chip/list-row click is the user's explicit ask to see that change. It degrades to
 * highlight-only for a path no longer in the diff, and for one the user has navigated past while the list
 * was still loading (the open loses to the newer navigation, as any pending preview does).
 */
export function ChangesPanel({ workspaceId }: { workspaceId: string }) {
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const changesRequest = useAppStore((s) => s.changesRequest);
	const changesView = useAppStore((s) => s.changesView);
	const setChangesView = useAppStore((s) => s.setChangesView);
	const activeTabId = useAppStore((s) => s.activeTabByWorkspace[workspaceId] ?? null);

	// The changed-file list, re-read on the workspace's fs tick; a switch clears the list and its deep-link
	// highlight, a failed re-read keeps the last good list (a failed first read reads as "no changes").
	useWorkspaceRead(workspaceId, (id) => getTransport().request("git.status", { workspaceId: id }), {
		onResult: (result) => setStatus(result),
		onFailure: () => setStatus((prev) => prev ?? { branch: "", changes: [] }),
		onSwitch: () => {
			setStatus(null);
			setHighlighted(null);
		},
	});

	// Open (or focus) the file's Monaco diff tab in the center; the row lights up either way. Stable per
	// workspace so the deep-link effect below can depend on it without re-firing per render.
	const openDiff = useCallback(
		(path: string, intent: TabIntent) => {
			setHighlighted(path);
			void openDiffInTab(workspaceId, path, intent);
		},
		[workspaceId],
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
			? activeTabId === diffTabId(workspaceId, path)
			: highlighted === path;

	if (status === null) {
		return <p className="px-sm py-xs text-xs text-hint">Loading…</p>;
	}
	if (status.changes.length === 0) {
		return (
			<p data-testid="changes-empty" className="px-sm py-xs text-xs text-hint">
				No changes in this workspace.
			</p>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="changes-view-toggle"
				role="toolbar"
				aria-label="Changes view mode"
				className="flex h-8 shrink-0 items-center justify-end gap-xs border-border2 border-b bg-bg-dark px-sm"
			>
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
				{changesView === "tree" ? (
					<ChangesTree changes={status.changes} onOpen={openDiff} isActive={isActive} />
				) : (
					<ul>
						{status.changes.map((change) => (
							<li key={change.path}>
								<button
									type="button"
									data-testid="change-item"
									data-status={change.status}
									data-active={isActive(change.path) ? true : undefined}
									onClick={() => openDiff(change.path, "preview")}
									onDoubleClick={() => openDiff(change.path, "keep")}
									className={`flex w-full items-center gap-sm px-sm py-xs text-left text-sm hover:bg-hover ${
										isActive(change.path) ? "bg-hover" : ""
									}`}
								>
									<span
										className={`min-w-0 flex-1 truncate ${statusNameClass(change.status) || "text-muted"}`}
									>
										{change.path}
									</span>
									<DiffStatBadge added={change.added ?? 0} removed={change.removed ?? 0} />
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
