import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type RightPanelTab, selectReviewDraftCount, useAppStore } from "../store";
import { ChangesPanel } from "./ChangesPanel";
import { FileTree } from "./FileTree";
import { ReviewPanel, selectActiveReviewedPath } from "./ReviewPanel";
import { SpecsPanel } from "./SpecsPanel";
import { useWorkspaceReview } from "./useWorkspaceReview";
import { useWorkspaceSpecs } from "./useWorkspaceSpecs";

/** Right panel for the active worktree: Specs (read-only spec-graph tree), All-files tree, Changes
 * (git diff vs base), and Review (draft comments → AI sessions; the tab carries a pending-draft badge). */
export function RightPanel() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const rightTabRequest = useAppStore((s) => s.rightTabRequest);
	const [tab, setTab] = useState<RightPanelTab>("specs");
	// Owned here, not in the tab body: the spec graph is app-wide state (the chat classifies its artifacts
	// with it), and this panel outlives any one tab. See `useWorkspaceSpecs`.
	const { failed: specsFailed, reload: reloadSpecs } = useWorkspaceSpecs(activeWorkspaceId);
	const draftCount = useAppStore((s) => selectReviewDraftCount(s, activeWorkspaceId));
	// Owned here like the specs read: the tab strip's Review flags need the snapshot with the panel closed.
	const { failed: reviewFailed } = useWorkspaceReview(activeWorkspaceId);

	// Opening a reviewed file auto-opens the Review tab (per-file view — see ReviewPanel). Keyed on the
	// ACTIVATION (the active tab id changing onto a reviewed path), so it fires once per open — the user
	// can still switch the rail away without being yanked back.
	const activeTabId = useAppStore((s) =>
		activeWorkspaceId ? (s.activeTabByWorkspace[activeWorkspaceId] ?? null) : null,
	);
	const activeReviewedPath = useAppStore((s) =>
		activeWorkspaceId ? selectActiveReviewedPath(s, activeWorkspaceId) : null,
	);
	const lastTabRef = useRef<string | null>(null);
	useEffect(() => {
		const previous = lastTabRef.current;
		lastTabRef.current = activeTabId;
		// Only a tab-id CHANGE counts as "opening" — a comment saved while the tab is already active
		// must not yank the rail (the inline card is the feedback there).
		if (!activeTabId || activeTabId === previous || !activeReviewedPath) return;
		setTab("review");
	}, [activeTabId, activeReviewedPath]);

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
			<div
				data-testid="right-tab-strip"
				className="flex h-panel-tab-strip shrink-0 items-center gap-md border-b border-border-default px-sm"
			>
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
				<TabButton testid="tab-review" active={tab === "review"} onClick={() => setTab("review")}>
					Review
					{draftCount > 0 && (
						<span
							data-testid="review-pending-badge"
							className="ml-[3px] inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-[3px] tr-text-label-pill text-text-on-primary"
						>
							{draftCount}
						</span>
					)}
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
				) : tab === "review" ? (
					<ReviewPanel workspaceId={activeWorkspaceId} failed={reviewFailed} />
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
