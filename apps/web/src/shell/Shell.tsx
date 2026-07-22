import {
	ArrowDown,
	ArrowUp,
	Box,
	Check,
	ChevronRight,
	GitBranch,
	PanelBottom,
	PanelLeft,
	PanelRight,
} from "lucide-react";
import { useEffect } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Tip, useIsTruncated } from "../components/Tip";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { CenterTabs } from "../panels/CenterTabs";
import { LeftPanel } from "../panels/LeftPanel";
import { Onboarding } from "../panels/Onboarding";
import { ProjectDialogs } from "../panels/ProjectDialogs";
import { ProjectView } from "../panels/ProjectView";
import { RightPanel } from "../panels/RightPanel";
import { SettingsDialog } from "../panels/SettingsDialog";
import { TerminalsPanel } from "../panels/TerminalsPanel";
import { Toaster } from "../panels/Toaster";
import { WelcomePanel } from "../panels/WelcomePanel";
import { selectActiveWorkspace, selectContextProject, useAppStore } from "../store";
import { applyTheme, writeThemeHint } from "../utils/theme";

/**
 * MOCK git status for the active worktree — placeholder visual data derived deterministically from the
 * workspace id, so different worktrees show different (stable) values. This is display-only: there is NO
 * real git-status polling or wire call in this change (see task-header-git-status). Replace with a real
 * per-workspace status feed when push/pull/sync is scoped.
 */
function mockGitStatus(workspaceId: string): { ahead: number; behind: number; dirty: boolean } {
	let h = 0;
	for (const ch of workspaceId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return { ahead: h % 4, behind: (h >> 2) % 3, dirty: (h >> 4) % 2 === 0 };
}

/** Read-only git-status cluster for the active workspace, shown at the right edge of the center header:
 * ahead/behind (or a synced glyph when both are 0) + a dirty indicator. No actions are wired. */
function GitStatusCluster({ workspaceId }: { workspaceId: string }) {
	const { ahead, behind, dirty } = mockGitStatus(workspaceId);
	const synced = ahead === 0 && behind === 0;
	return (
		<div data-testid="git-status" className="flex shrink-0 items-center gap-md pl-md text-xs">
			{synced ? (
				<Tip side="bottom" label="Up to date with the remote">
					<span data-testid="git-synced" className="flex items-center gap-xs text-hint">
						<Check className="size-3.5" />
						up to date
					</span>
				</Tip>
			) : (
				<span
					data-testid="git-aheadbehind"
					className="flex items-center gap-sm font-[var(--font-mono)]"
				>
					<span className="flex items-center gap-0.5 text-primary" title="Commits ahead of remote">
						<ArrowUp className="size-3" />
						{ahead}
					</span>
					<span className="flex items-center gap-0.5 text-gold" title="Commits behind remote">
						<ArrowDown className="size-3" />
						{behind}
					</span>
				</span>
			)}
			{dirty ? (
				<span data-testid="git-dirty" className="flex items-center gap-xs text-muted">
					<span className="size-1.5 rounded-full bg-gold" />
					uncommitted
				</span>
			) : null}
		</div>
	);
}

/** The center-column top header: a single-line project › branch breadcrumb at the left and, for an
 * active workspace, the read-only git-status cluster at the right. */
function MainHeader() {
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const contextProject = useAppStore(selectContextProject);
	const nameLabel = activeWorkspace?.name ?? "Project home";
	// Full-name tooltips on the breadcrumb items only when the label is actually clipped.
	const { ref: projectRef, truncated: projectTruncated } = useIsTruncated<HTMLSpanElement>();
	const { ref: nameRef, truncated: nameTruncated } = useIsTruncated<HTMLSpanElement>();
	const projectSpan = (
		<span
			ref={projectRef}
			data-testid="scope-project"
			className="max-w-[160px] truncate text-muted"
		>
			{contextProject?.name}
		</span>
	);
	const nameSpan = (
		<span
			ref={nameRef}
			data-testid="scope-name"
			className="max-w-[240px] truncate font-medium text-text"
		>
			{nameLabel}
		</span>
	);
	// The base branch lives here (a tooltip on the branch name), not on a persistent second line.
	const baseTip = activeWorkspace
		? nameTruncated
			? `${nameLabel} · from ${activeWorkspace.baseBranch}`
			: `from ${activeWorkspace.baseBranch}`
		: null;
	return (
		<header className="flex h-[48px] shrink-0 items-center justify-between gap-md border-border2 border-b bg-bg-dark px-lg">
			{contextProject ? (
				<div
					data-testid="scope-context"
					data-context={activeWorkspace ? "workspace" : "project-home"}
					className="flex min-w-0 items-center gap-xs text-xs"
				>
					<span className="hidden min-w-0 items-center gap-xs sm:flex">
						<Box className="size-3.5 shrink-0 text-muted" />
						{projectTruncated ? (
							<Tip side="bottom" label={contextProject.name}>
								{projectSpan}
							</Tip>
						) : (
							projectSpan
						)}
						<ChevronRight className="size-3 shrink-0 text-hint" />
					</span>
					{activeWorkspace ? <GitBranch className="size-3.5 shrink-0 text-text" /> : null}
					{baseTip ? (
						<Tip side="bottom" label={baseTip}>
							{nameSpan}
						</Tip>
					) : nameTruncated ? (
						<Tip side="bottom" label={nameLabel}>
							{nameSpan}
						</Tip>
					) : (
						nameSpan
					)}
				</div>
			) : (
				<span />
			)}
			{activeWorkspace ? <GitStatusCluster workspaceId={activeWorkspace.id} /> : null}
		</header>
	);
}

/** A collapsed side panel's persistent sliver: a fixed-width full-height bar whose 48px top holds the
 * re-expand toggle (the same toggle, so it stays reachable), over an empty body. */
function CollapsedRail({ side, onExpand }: { side: "left" | "right"; onExpand: () => void }) {
	const Icon = side === "left" ? PanelLeft : PanelRight;
	const label = side === "left" ? "Expand left panel" : "Expand right panel";
	return (
		<div
			data-testid={`${side}-rail-collapsed`}
			className={`flex h-full w-9 shrink-0 flex-col ${side === "left" ? "border-border2 border-r bg-surface-sidebar" : "border-border2 border-l bg-surface-content"}`}
		>
			<div className="flex h-[48px] shrink-0 items-center justify-center border-border2 border-b">
				<Tip side={side === "left" ? "right" : "left"} label={label}>
					<button
						type="button"
						data-testid={`toggle-${side}-panel`}
						aria-label={label}
						onClick={onExpand}
						className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
					>
						<Icon className="size-4" />
					</button>
				</Tip>
			</div>
		</div>
	);
}

export function Shell() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const hasActiveWorkspace = activeWorkspaceId != null;
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const panelCollapsed = useAppStore((s) => s.panelCollapsed);
	const togglePanel = useAppStore((s) => s.togglePanel);
	// The single owner of the theme DOM side-effect: apply the store's (host-owned) theme + cache it as the
	// next load's first-paint hint. The store is fed by transport (welcome / settings.changed).
	const theme = useAppStore((s) => s.theme);
	useEffect(() => {
		applyTheme(theme);
		writeThemeHint(theme);
	}, [theme]);

	const leftCollapsed = panelCollapsed.left;
	// The terminal region collapses downward (worktree-only): its panel is omitted and a thin re-expand
	// bar takes its place — the same collapse pattern as the side panels.
	const terminalCollapsed = panelCollapsed.terminal;
	// The right rail is contextual: it's open for an active worktree AND for a selected project (the
	// read-only main view) — only the tab set differs (RightPanel). The terminal, though, is worktree-only
	// (mounted below only when there's an active workspace). Collapse applies whenever a rail exists.
	const hasRail = hasActiveWorkspace || selectedProjectId != null;
	const showRight = hasRail && !panelCollapsed.right;
	return (
		<div data-testid="shell" className="h-full">
			{/* Full-height columns, each with its own top; a collapsed side becomes a thin rail (with the
			    re-expand toggle) beside the group, and its panel is omitted so the center flexes into the gap.
			    The center panel keeps its slot, so its content (tabs/terminals/editor) never remounts. */}
			<div className="flex h-full">
				{leftCollapsed ? <CollapsedRail side="left" onExpand={() => togglePanel("left")} /> : null}
				<div className="min-w-0 flex-1">
					<ResizablePanelGroup
						direction="horizontal"
						autoSaveId="thinkrail-cols"
						className="h-full"
					>
						{!leftCollapsed ? (
							<ResizablePanel id="left" order={1} defaultSize={18} minSize={12}>
								<LeftPanel />
							</ResizablePanel>
						) : null}
						{!leftCollapsed ? (
							<ResizableHandle direction="horizontal" data-testid="resize-left" />
						) : null}
						<ResizablePanel id="center" order={2} defaultSize={hasRail ? 52 : 82} minSize={28}>
							{hasActiveWorkspace ? (
								<div className="grid h-full grid-rows-[auto_1fr]">
									<MainHeader />
									<main data-testid="center-tabs" className="min-h-0 bg-surface-content">
										<ErrorBoundary label="Editor" resetKeys={[activeWorkspaceId]}>
											<CenterTabs />
										</ErrorBoundary>
									</main>
								</div>
							) : selectedProjectId != null ? (
								// A selected project opens read-only in the center (its own header); the contextual right rail
								// (Specs/All files/Scripts/Hooks) is beside it, with no terminal (worktree-scoped).
								<ErrorBoundary label="Project" resetKeys={[selectedProjectId]}>
									<ProjectView key={selectedProjectId} projectId={selectedProjectId} />
								</ErrorBoundary>
							) : (
								<div className="grid h-full grid-rows-[auto_1fr]">
									<MainHeader />
									<div className="min-h-0 bg-surface-content">
										<WelcomePanel />
									</div>
								</div>
							)}
						</ResizablePanel>
						{showRight ? (
							<ResizableHandle direction="horizontal" data-testid="resize-right" />
						) : null}
						{showRight ? (
							<ResizablePanel id="right" order={3} defaultSize={30} minSize={16}>
								{hasActiveWorkspace ? (
									<div className="flex h-full min-h-0 flex-col">
										<ResizablePanelGroup
											direction="vertical"
											autoSaveId="thinkrail-right"
											className="min-h-0 flex-1"
										>
											<ResizablePanel id="right-files" order={1} defaultSize={60} minSize={20}>
												<div
													data-testid="right-panel"
													className="h-full min-h-0 bg-surface-content"
												>
													<ErrorBoundary label="Files" resetKeys={[activeWorkspaceId]}>
														<RightPanel />
													</ErrorBoundary>
												</div>
											</ResizablePanel>
											{!terminalCollapsed ? (
												<ResizableHandle direction="vertical" data-testid="resize-terminals" />
											) : null}
											{!terminalCollapsed ? (
												<ResizablePanel
													id="right-terminals"
													order={2}
													defaultSize={40}
													minSize={15}
												>
													<div className="h-full min-h-0 bg-surface-content">
														<ErrorBoundary label="Terminals" resetKeys={[activeWorkspaceId]}>
															<TerminalsPanel />
														</ErrorBoundary>
													</div>
												</ResizablePanel>
											) : null}
										</ResizablePanelGroup>
										{terminalCollapsed ? (
											// Collapsed: a thin bar with a re-expand chevron takes the terminal's place.
											<div
												data-testid="terminal-collapsed"
												className="flex h-7 shrink-0 items-center border-border2 border-t bg-surface-content px-sm"
											>
												<Tip side="top" label="Expand terminal">
													<button
														type="button"
														data-testid="toggle-terminal-panel"
														aria-label="Expand terminal panel"
														onClick={() => togglePanel("terminal")}
														className="flex items-center rounded-[var(--radius-sm)] px-0.5 text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
													>
														<PanelBottom className="size-4" />
													</button>
												</Tip>
											</div>
										) : null}
									</div>
								) : (
									// Project context: the rail only — no terminal (terminals are worktree-scoped).
									<div data-testid="right-panel" className="h-full min-h-0 bg-surface-content">
										<ErrorBoundary label="Project rail" resetKeys={[selectedProjectId]}>
											<RightPanel />
										</ErrorBoundary>
									</div>
								)}
							</ResizablePanel>
						) : null}
					</ResizablePanelGroup>
				</div>
				{hasRail && panelCollapsed.right ? (
					<CollapsedRail side="right" onExpand={() => togglePanel("right")} />
				) : null}
			</div>
			<SettingsDialog />
			<Onboarding />
			<ProjectDialogs />
			<Toaster />
		</div>
	);
}
