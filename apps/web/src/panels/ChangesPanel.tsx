import type { GitFileStatus, GitStatus } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

const STATUS_LABEL: Record<GitFileStatus, string> = {
	added: "A",
	modified: "M",
	deleted: "D",
	renamed: "R",
	untracked: "U",
};
const STATUS_COLOR: Record<GitFileStatus, string> = {
	added: "text-green",
	modified: "text-gold",
	deleted: "text-red",
	renamed: "text-blue",
	untracked: "text-green",
};

/** A diff tab's id — the one-tab-per-file identity (re-clicking a row focuses the existing tab). */
function diffTabId(workspaceId: string, path: string): string {
	return `${workspaceId}:diff:${path}`;
}

/**
 * Changes for the active worktree: the changed-file list (vs base). Clicking a file opens (or focuses)
 * its Monaco diff tab in the center — the diff itself renders there (`DiffPane`), not under the list.
 * Live: the store's per-workspace fs tick silently re-reads `git.status`; the open diff tabs follow the
 * disk on their own (DiffPane's re-read). A chat deep-link only highlights its row — no tab is opened
 * until the user clicks.
 */
export function ChangesPanel({ workspaceId }: { workspaceId: string }) {
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const changesRequest = useAppStore((s) => s.changesRequest);
	const fsTick = useAppStore((s) => s.fsChangesByWorkspace[workspaceId]?.tick ?? 0);
	const activeTabId = useAppStore((s) => s.activeTabByWorkspace[workspaceId] ?? null);

	// Hard reset only on workspace switch — a tick refresh keeps the old list until the re-read lands.
	// biome-ignore lint/correctness/useExhaustiveDependencies: workspaceId is the trigger (reset-on-switch), not a body input
	useEffect(() => {
		setStatus(null);
		setHighlighted(null);
	}, [workspaceId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: fsTick is the live-refresh trigger, not a body input
	useEffect(() => {
		let cancelled = false;
		getTransport()
			.request("git.status", { workspaceId })
			.then((s) => {
				if (!cancelled) setStatus(s);
			})
			.catch(() => {
				if (!cancelled) setStatus((prev) => prev ?? { branch: "", changes: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, fsTick]);

	// Open (or focus) the file's Monaco diff tab in the center.
	const openDiff = async (path: string) => {
		setHighlighted(path);
		const id = diffTabId(workspaceId, path);
		const store = useAppStore.getState();
		if ((store.tabsByWorkspace[workspaceId] ?? []).some((t) => t.id === id)) {
			store.setActiveTab(id);
			return;
		}
		try {
			const { original, modified } = await getTransport().request("git.diffFile", {
				workspaceId,
				path,
			});
			const name = path.split("/").pop() || path;
			// Stamp the workspace's current fs tick: the contents are fresh as of now, so DiffPane's live
			// re-read only fires for ticks arriving AFTER this open.
			const loadedTick = useAppStore.getState().fsChangesByWorkspace[workspaceId]?.tick ?? 0;
			useAppStore
				.getState()
				.openTab({ kind: "diff", id, workspaceId, path, name, original, modified, loadedTick });
		} catch {
			// a failed read leaves tabs unchanged; the row stays for a retry
		}
	};

	// A chat deep-link (turn-divider chip) targeting this workspace: highlight the requested row once the
	// status list is loaded — the diff opens only on the user's explicit click. Match by suffix so an
	// absolute pi path still resolves to the relative entry.
	useEffect(() => {
		if (!status || changesRequest?.workspaceId !== workspaceId) return;
		const want = changesRequest.path;
		// Anchor the suffix at a path separator so an absolute pi path resolves to its relative entry
		// without `a-foo.ts` spuriously matching the entry `foo.ts`.
		const match = status.changes.find((c) => c.path === want || want.endsWith(`/${c.path}`));
		setHighlighted(match ? match.path : want);
	}, [changesRequest, status, workspaceId]);

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
		<ul className="h-full overflow-auto">
			{status.changes.map((change) => {
				const isActive =
					activeTabId === diffTabId(workspaceId, change.path) || highlighted === change.path;
				return (
					<li key={change.path}>
						<button
							type="button"
							data-testid="change-item"
							data-status={change.status}
							onClick={() => void openDiff(change.path)}
							className={`flex w-full items-center gap-sm px-sm py-xs text-left text-sm hover:bg-hover ${
								isActive ? "bg-hover" : ""
							}`}
						>
							<span className={`w-3 shrink-0 text-center text-xs ${STATUS_COLOR[change.status]}`}>
								{STATUS_LABEL[change.status]}
							</span>
							<span className="truncate text-muted">{change.path}</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}
