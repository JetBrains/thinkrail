import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { type RightPanelTab, useAppStore } from "../store";
import { ChangesPanel } from "./ChangesPanel";
import { FileTree } from "./FileTree";
import { SpecsPanel } from "./SpecsPanel";
import { useWorkspaceSpecs } from "./useWorkspaceSpecs";

/** Right panel for the active worktree: Specs (read-only spec-graph tree), All-files tree, and Changes (git diff vs base). Checks/Review = V2. */
export function RightPanel() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const rightTabRequest = useAppStore((s) => s.rightTabRequest);
	const [tab, setTab] = useState<RightPanelTab>("specs");
	// Owned here, not in the tab body: the spec graph is app-wide state (the chat classifies its artifacts
	// with it), and this panel outlives any one tab. See `useWorkspaceSpecs`.
	const { failed: specsFailed, reload: reloadSpecs } = useWorkspaceSpecs(activeWorkspaceId);

	// Anything outside the panel that wants a view shown raises one intent (`requestRightTab`, carried along
	// by the chat deep-links too), so the flip is decided in a single place rather than inferred from each
	// path request — and a chip that only reveals its own artifact list needs no path to do it.
	useEffect(() => {
		if (rightTabRequest?.workspaceId !== activeWorkspaceId) return;
		setTab(rightTabRequest.tab);
		useAppStore.getState().clearRightTabRequest(); // one flip per request; never replayed on re-activation
	}, [rightTabRequest, activeWorkspaceId]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-7 shrink-0 items-center gap-md border-b border-border-default px-sm">
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
						onClick={reloadSpecs}
						className="ml-auto text-text-muted hover:text-text-muted"
					>
						<RefreshCw className="size-3.5" />
					</button>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{!activeWorkspaceId ? (
					<p className="p-sm tr-text-metadata text-text-muted">
						Select a workspace to browse files.
					</p>
				) : tab === "specs" ? (
					<div className="p-xs">
						<SpecsPanel workspaceId={activeWorkspaceId} failed={specsFailed} />
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
			className={`tr-text-eyebrow ${active ? "text-text-default" : "text-text-muted hover:text-text-muted"}`}
		>
			{children}
		</button>
	);
}
