import { useAppStore } from "../store/appStore";
import { FileTree } from "./FileTree";

/** Right panel: the active worktree's file tree (All files). Changes / Checks land at M8 / V2. */
export function RightPanel() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	return (
		<div className="flex h-full flex-col">
			<div className="flex h-7 shrink-0 items-center gap-md border-b border-border px-sm">
				<span className="text-xs font-medium uppercase tracking-wider text-text">All files</span>
				<span className="text-xs uppercase tracking-wider text-hint">Changes</span>
			</div>
			<div className="flex-1 overflow-auto p-xs">
				{activeWorkspaceId ? (
					<FileTree workspaceId={activeWorkspaceId} />
				) : (
					<p className="p-sm text-xs text-hint">Select a workspace to browse files.</p>
				)}
			</div>
		</div>
	);
}
