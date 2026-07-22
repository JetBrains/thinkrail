import type { GitFileStatus, GitStatus } from "@thinkrail/contracts";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { openDiffInTab } from "./openFile";

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

/**
 * Changes for the active worktree: the changed-file list (vs base) — nothing else, so the right panel
 * keeps its two regions (panel content over terminals). Clicking a row opens the file's diff as a
 * center tab (`openDiffInTab` → `DiffPane`, Monaco's side-by-side diff editor).
 * Live: the store's per-workspace fs tick silently re-reads `git.status`.
 */
export function ChangesPanel({ workspaceId }: { workspaceId: string }) {
	const [status, setStatus] = useState<GitStatus | null>(null);
	const changesRequest = useAppStore((s) => s.changesRequest);
	const fsTick = useAppStore((s) => s.fsChangesByWorkspace[workspaceId]?.tick ?? 0);
	// The deep-link request already turned into a tab — opening is a one-shot side effect, so a later
	// status refresh re-running the effect must not re-open (and re-focus) the tab.
	const handledRequestRef = useRef<typeof changesRequest>(null);

	// Hard reset only on workspace switch — a tick refresh keeps the old list until the re-read lands.
	// biome-ignore lint/correctness/useExhaustiveDependencies: workspaceId is the trigger (reset-on-switch), not a body input
	useEffect(() => {
		setStatus(null);
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

	// A chat deep-link (turn-divider chip) targeting this workspace: open the requested file's diff tab
	// once the status list is loaded. Match by suffix so an absolute pi path still resolves to the
	// relative entry.
	useEffect(() => {
		if (!status || changesRequest?.workspaceId !== workspaceId) return;
		if (handledRequestRef.current === changesRequest) return;
		handledRequestRef.current = changesRequest;
		const want = changesRequest.path;
		// Anchor the suffix at a path separator so an absolute pi path resolves to its relative entry
		// without `a-foo.ts` spuriously matching the entry `foo.ts`.
		const match = status.changes.find((c) => c.path === want || want.endsWith(`/${c.path}`));
		openDiffInTab(workspaceId, match ? match.path : want);
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
		<ul className="h-full min-h-0 overflow-auto">
			{status.changes.map((change) => (
				<li key={change.path}>
					<button
						type="button"
						data-testid="change-item"
						data-status={change.status}
						onClick={() => openDiffInTab(workspaceId, change.path)}
						className="flex w-full items-center gap-sm px-sm py-xs text-left text-sm hover:bg-hover"
					>
						<span className={`w-3 shrink-0 text-center text-xs ${STATUS_COLOR[change.status]}`}>
							{STATUS_LABEL[change.status]}
						</span>
						<span className="truncate text-muted">{change.path}</span>
					</button>
				</li>
			))}
		</ul>
	);
}
