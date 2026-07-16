import type { GitFileStatus, GitStatus } from "@thinkrail/contracts";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

const DiffViewer = lazy(() => import("./DiffViewer"));

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
 * Changes for the active worktree: changed-file list (vs base) over the selected file's diff.
 * Live: the store's per-workspace fs tick silently re-reads `git.status`; the selection survives while
 * its path is still listed (its diff is re-read too — the content may have changed), else it clears.
 */
export function ChangesPanel({ workspaceId }: { workspaceId: string }) {
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [diff, setDiff] = useState<string | null>(null);
	const changesRequest = useAppStore((s) => s.changesRequest);
	const fsTick = useAppStore((s) => s.fsChangesByWorkspace[workspaceId]?.tick ?? 0);
	// The live selection, readable from the async status refetch without re-running it on select.
	const selectedRef = useRef<string | null>(null);

	// Hard reset only on workspace switch — a tick refresh keeps the old list until the re-read lands.
	// biome-ignore lint/correctness/useExhaustiveDependencies: workspaceId is the trigger (reset-on-switch), not a body input
	useEffect(() => {
		setStatus(null);
		setSelected(null);
		selectedRef.current = null;
		setDiff(null);
	}, [workspaceId]);

	const selectFile = async (path: string) => {
		setSelected(path);
		selectedRef.current = path;
		setDiff(null);
		try {
			const result = await getTransport().request("git.diff", { workspaceId, path });
			setDiff(result.diff);
		} catch {
			setDiff("");
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: fsTick is the live-refresh trigger, not a body input
	useEffect(() => {
		let cancelled = false;
		getTransport()
			.request("git.status", { workspaceId })
			.then((s) => {
				if (cancelled) return;
				setStatus(s);
				// Reconcile the selection against the fresh list: gone → clear; still there → re-read its
				// diff QUIETLY (the old diff stays visible until the new one lands — no loading flash).
				const sel = selectedRef.current;
				if (sel && !s.changes.some((c) => c.path === sel)) {
					setSelected(null);
					selectedRef.current = null;
					setDiff(null);
				} else if (sel) {
					getTransport()
						.request("git.diff", { workspaceId, path: sel })
						.then((r) => {
							if (!cancelled && selectedRef.current === sel) setDiff(r.diff);
						})
						.catch(() => {});
				}
			})
			.catch(() => {
				if (!cancelled) setStatus((prev) => prev ?? { branch: "", changes: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, fsTick]);

	// A chat deep-link (turn-divider chip) targeting this workspace: select the requested file once the
	// status list is loaded. Match by suffix so an absolute pi path still resolves to the relative entry.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `selectFile` is stable enough; the request + status are the triggers
	useEffect(() => {
		if (!status || changesRequest?.workspaceId !== workspaceId) return;
		const want = changesRequest.path;
		// Anchor the suffix at a path separator so an absolute pi path resolves to its relative entry
		// without `a-foo.ts` spuriously matching the entry `foo.ts`.
		const match = status.changes.find((c) => c.path === want || want.endsWith(`/${c.path}`));
		void selectFile(match ? match.path : want);
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
		<div className="flex h-full min-h-0 flex-col">
			<ul className="max-h-1/3 shrink-0 overflow-auto border-b border-border2">
				{status.changes.map((change) => (
					<li key={change.path}>
						<button
							type="button"
							data-testid="change-item"
							data-status={change.status}
							onClick={() => void selectFile(change.path)}
							className={`flex w-full items-center gap-sm px-sm py-xs text-left text-sm hover:bg-hover ${
								selected === change.path ? "bg-hover" : ""
							}`}
						>
							<span className={`w-3 shrink-0 text-center text-xs ${STATUS_COLOR[change.status]}`}>
								{STATUS_LABEL[change.status]}
							</span>
							<span className="truncate text-muted">{change.path}</span>
						</button>
					</li>
				))}
			</ul>
			<div data-testid="diff-viewer" className="min-h-0 flex-1 overflow-auto">
				{selected === null ? (
					<p className="px-sm py-xs text-xs text-hint">Select a file to see its diff.</p>
				) : diff === null ? (
					<p className="px-sm py-xs text-xs text-hint">Loading diff…</p>
				) : (
					<Suspense fallback={<p className="px-sm py-xs text-xs text-hint">Loading…</p>}>
						<DiffViewer diff={diff} />
					</Suspense>
				)}
			</div>
		</div>
	);
}
