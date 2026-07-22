import { PanelRight, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Tip } from "@/components/Tip";
import { useAppStore } from "../store";
import { ChangesPanel } from "./ChangesPanel";
import { FileTree } from "./FileTree";
import { HooksPanel } from "./HooksPanel";
import { ScriptsPanel } from "./ScriptsPanel";
import { SpecsPanel } from "./SpecsPanel";

type RightTab = "specs" | "files" | "changes" | "scripts" | "hooks";

const WORKTREE_TABS: RightTab[] = ["specs", "files", "changes"];
const PROJECT_TABS: RightTab[] = ["specs", "files", "scripts", "hooks"];

/**
 * The contextual right rail. It is always open in both contexts, and its tab set follows what's active:
 * a **worktree** → Specs / All files / Changes (scoped to the worktree); a **project** (read-only main
 * view) → Specs / All files / Scripts / Hooks (project-level). Scripts/Hooks are project-only; Changes is
 * worktree-only. Specs/All files need a worktree fs, so in project context they show a muted placeholder
 * (no project-fs wire — frontend-only). Default tab = Specs.
 */
export function RightPanel() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const changesRequest = useAppStore((s) => s.changesRequest);
	const railTabRequest = useAppStore((s) => s.railTabRequest);
	const togglePanel = useAppStore((s) => s.togglePanel);
	const [tab, setTab] = useState<RightTab>("specs");
	const [specsRefresh, setSpecsRefresh] = useState(0);

	const context: "worktree" | "project" = activeWorkspaceId ? "worktree" : "project";

	// Switching context (project ↔ worktree) resets to a tab valid there (Specs) when the current one isn't.
	useEffect(() => {
		const valid = context === "worktree" ? WORKTREE_TABS : PROJECT_TABS;
		setTab((t) => (valid.includes(t) ? t : "specs"));
	}, [context]);

	// A deep-link from chat (turn-divider chip) targeting this workspace flips us to the Changes view.
	useEffect(() => {
		if (changesRequest?.workspaceId === activeWorkspaceId) setTab("changes");
	}, [changesRequest, activeWorkspaceId]);

	// The project row's settings gear jumps the (already-open) project rail to its requested tab (Hooks).
	// Declared after the context-reset effect so it wins when both fire on the same project switch.
	useEffect(() => {
		if (!railTabRequest || context !== "project") return;
		if (railTabRequest.tab === "hooks" || railTabRequest.tab === "scripts") {
			setTab(railTabRequest.tab);
		}
	}, [railTabRequest, context]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			{/* 48px to match the left panel top + center header, so all three bottom dividers align. */}
			<div className="flex h-[48px] shrink-0 items-center gap-md border-b border-border2 px-sm">
				<TabButton testid="tab-specs" active={tab === "specs"} onClick={() => setTab("specs")}>
					Specs
				</TabButton>
				<TabButton testid="tab-files" active={tab === "files"} onClick={() => setTab("files")}>
					All files
				</TabButton>
				{context === "worktree" ? (
					<TabButton
						testid="tab-changes"
						active={tab === "changes"}
						onClick={() => setTab("changes")}
					>
						Changes
					</TabButton>
				) : (
					<>
						<TabButton
							testid="tab-scripts"
							active={tab === "scripts"}
							onClick={() => setTab("scripts")}
						>
							Scripts
						</TabButton>
						<TabButton testid="tab-hooks" active={tab === "hooks"} onClick={() => setTab("hooks")}>
							Hooks
						</TabButton>
					</>
				)}
				{/* Right-end controls, adjacent + aligned: refresh (worktree Specs only) then collapse (rightmost). */}
				<div className="ml-auto flex items-center gap-sm">
					{tab === "specs" && activeWorkspaceId && (
						<Tip side="bottom" label="Refresh specs">
							<button
								type="button"
								data-testid="specs-refresh"
								aria-label="Refresh specs"
								onClick={() => setSpecsRefresh((n) => n + 1)}
								className="text-hint hover:text-muted"
							>
								<RefreshCw className="size-3.5" />
							</button>
						</Tip>
					)}
					<Tip side="bottom" label="Collapse right panel">
						<button
							type="button"
							data-testid="toggle-right-panel"
							aria-label="Collapse right panel"
							onClick={() => togglePanel("right")}
							className="text-hint hover:text-muted"
						>
							<PanelRight className="size-3.5" />
						</button>
					</Tip>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{context === "worktree" && activeWorkspaceId ? (
					tab === "specs" ? (
						<div className="p-xs">
							<SpecsPanel workspaceId={activeWorkspaceId} refreshToken={specsRefresh} />
						</div>
					) : tab === "files" ? (
						<div className="p-xs">
							<FileTree workspaceId={activeWorkspaceId} />
						</div>
					) : (
						<ChangesPanel workspaceId={activeWorkspaceId} />
					)
				) : tab === "scripts" ? (
					<ScriptsPanel />
				) : tab === "hooks" ? (
					<HooksPanel />
				) : (
					// Project context, Specs / All files: no worktree fs to read here.
					<p className="p-sm text-xs text-hint">
						Open a worktree to browse its {tab === "specs" ? "specs" : "files"}.
					</p>
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
