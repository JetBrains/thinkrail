import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { ChangesPanel } from "./ChangesPanel";
import { FileTree } from "./FileTree";
import { SpecsPanel } from "./SpecsPanel";

type RightTab = "specs" | "files" | "changes";

/** Right panel for the active worktree: Specs (read-only spec-graph tree), All-files tree, and Changes (git diff vs base). Checks/Review = V2. */
export function RightPanel() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const changesRequest = useAppStore((s) => s.changesRequest);
	const [tab, setTab] = useState<RightTab>("specs");
	const [specsRefresh, setSpecsRefresh] = useState(0);

	// A deep-link from chat (turn-divider chip) targeting this workspace flips us to the Changes view.
	useEffect(() => {
		if (changesRequest?.workspaceId === activeWorkspaceId) setTab("changes");
	}, [changesRequest, activeWorkspaceId]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-7 shrink-0 items-center gap-md border-b border-border2 px-sm">
				<TabButton testid="tab-specs" active={tab === "specs"} onClick={() => setTab("specs")}>
					Specs
				</TabButton>
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
				{tab === "specs" && activeWorkspaceId && (
					<button
						type="button"
						data-testid="specs-refresh"
						aria-label="Refresh specs"
						title="Refresh specs"
						onClick={() => setSpecsRefresh((n) => n + 1)}
						className="ml-auto text-hint hover:text-muted"
					>
						<RefreshCw className="size-3.5" />
					</button>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{!activeWorkspaceId ? (
					<p className="p-sm text-xs text-hint">Select a workspace to browse files.</p>
				) : tab === "specs" ? (
					<div className="p-xs">
						<SpecsPanel key={specsRefresh} workspaceId={activeWorkspaceId} />
					</div>
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
