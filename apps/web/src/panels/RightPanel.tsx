import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { ChangesPanel } from "./ChangesPanel";
import { FileTree } from "./FileTree";

type RightTab = "files" | "changes";

/** Right panel for the active worktree: All-files tree and Changes (git diff vs base). Checks/Review = V2. */
export function RightPanel() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const [tab, setTab] = useState<RightTab>("files");

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-7 shrink-0 items-center gap-md border-b border-border2 px-sm">
				<TabButton testid="tab-files" active={tab === "files"} onClick={() => setTab("files")}>
					All files
				</TabButton>
				<TabButton
					testid="tab-changes"
					active={tab === "changes"}
					onClick={() => setTab("changes")}
				>
					Changes
				</TabButton>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{!activeWorkspaceId ? (
					<p className="p-sm text-xs text-hint">Select a workspace to browse files.</p>
				) : tab === "files" ? (
					<div className="p-xs">
						<FileTree workspaceId={activeWorkspaceId} />
					</div>
				) : (
					<ChangesPanel workspaceId={activeWorkspaceId} />
				)}
			</div>
		</div>
	);
}

function TabButton({
	testid,
	active,
	onClick,
	children,
}: {
	testid: string;
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			data-active={active}
			onClick={onClick}
			className={`text-xs uppercase tracking-wider ${
				active ? "font-medium text-text" : "text-hint hover:text-muted"
			}`}
		>
			{children}
		</button>
	);
}
