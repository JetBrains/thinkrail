import type { GitFileStatus, GitStatus } from "@thinkrail-pi/contracts";
import { lazy, Suspense, useEffect, useState } from "react";
import { getTransport } from "../wireTransport";

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

/** Changes for the active worktree: changed-file list (vs base) over the selected file's diff. */
export function ChangesPanel({ workspaceId }: { workspaceId: string }) {
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [diff, setDiff] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setStatus(null);
		setSelected(null);
		setDiff(null);
		getTransport()
			.request("git.status", { workspaceId })
			.then((s) => {
				if (!cancelled) setStatus(s);
			})
			.catch(() => {
				if (!cancelled) setStatus({ branch: "", changes: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	const selectFile = async (path: string) => {
		setSelected(path);
		setDiff(null);
		try {
			const result = await getTransport().request("git.diff", { workspaceId, path });
			setDiff(result.diff);
		} catch {
			setDiff("");
		}
	};

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
