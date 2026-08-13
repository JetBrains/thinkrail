import { ChevronRight, GitBranch, Settings } from "lucide-react";
import { useEffect, useRef } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { CenterTabs } from "../panels/CenterTabs";
import { ProjectTree } from "../panels/ProjectTree";
import { RightPanel } from "../panels/RightPanel";
import { SettingsDialog } from "../panels/SettingsDialog";
import { TerminalsPanel } from "../panels/TerminalsPanel";
import { Toaster } from "../panels/Toaster";
import { WelcomePanel } from "../panels/WelcomePanel";
import {
	isUserOwnedWorkspace,
	selectActiveWorkspace,
	selectContextProject,
	useAppStore,
} from "../store";
import { applyTheme, writeThemeHint } from "../themes";
import type { ConnectionStatus } from "../transport";
import { BrandLogo } from "./BrandLogo";
import { CollapsedPanelRail } from "./CollapsedPanelRail";
import { useCollapsibleRegion } from "./useCollapsibleRegion";
import { useGlobalHotkeys } from "./useGlobalHotkeys";
import { openReviewLabel, useOpenBranchReview } from "./useOpenBranchReview";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	connected: "Connected",
	connecting: "Connecting…",
	disconnected: "Disconnected",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
	connected: "bg-feedback-success",
	connecting: "bg-feedback-warning",
	disconnected: "bg-feedback-error",
};

export function Shell() {
	const status = useAppStore((s) => s.status);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const contextProject = useAppStore(selectContextProject);
	const openReview = useOpenBranchReview(activeWorkspace, status);
	const hasActiveWorkspace = activeWorkspaceId != null;

	// Welcome and workspace layouts deliberately keep separate saved left sizes, so each gets its own
	// collapse/focus memory too. The right region only exists in the workspace layout.
	const workspaceCenterRef = useRef<HTMLElement>(null);
	const welcomeCenterRef = useRef<HTMLDivElement>(null);
	const workspaceProjects = useCollapsibleRegion(workspaceCenterRef, "workspace-left");
	const welcomeProjects = useCollapsibleRegion(welcomeCenterRef, "welcome-left");
	const workspaceRight = useCollapsibleRegion<HTMLDivElement>(
		workspaceCenterRef,
		"workspace-right",
	);
	const activeProjects = hasActiveWorkspace ? workspaceProjects : welcomeProjects;

	// The single owner of the theme DOM side-effect: apply the store's (host-owned) theme + cache it as the
	// next load's first-paint hint. The store is fed by transport (welcome / settings.changed).
	const theme = useAppStore((s) => s.theme);
	useEffect(() => {
		applyTheme(theme);
		writeThemeHint(theme);
	}, [theme]);
	// App-wide chords the browser would otherwise take: history plus the two focus-aware side regions.
	useGlobalHotkeys({
		onProjects: activeProjects.focusOrCollapse,
		...(hasActiveWorkspace ? { onWorkspace: workspaceRight.focusOrCollapse } : {}),
	});
	return (
		<div data-testid="shell" className="grid h-full grid-rows-[auto_1fr]">
			<header className="flex items-center justify-between border-b border-border-default bg-container-header-bg px-lg py-sm">
				<div className="flex min-w-0 items-center gap-md">
					<BrandLogo />
					{contextProject ? (
						<div
							data-testid="scope-context"
							data-context={activeWorkspace ? "workspace" : "project-home"}
							className="min-w-0 border-border-default border-l pl-md leading-tight"
						>
							<div className="flex min-w-0 items-center gap-xs tr-text-ui">
								<span className="hidden min-w-0 items-center gap-xs sm:flex">
									<span
										data-testid="scope-project"
										className="max-w-[160px] truncate text-text-muted"
									>
										{contextProject.name}
									</span>
									<ChevronRight className="size-3 shrink-0 text-text-muted" />
								</span>
								<span data-testid="scope-name" className="max-w-[220px] truncate text-text-default">
									{activeWorkspace?.name ?? "Project home"}
								</span>
							</div>
							{activeWorkspace ? (
								<div className="mt-0.5 flex min-w-0 items-center gap-xs text-text-muted tr-text-metadata">
									<GitBranch className="size-3 shrink-0" />
									<span data-testid="scope-branch" className="truncate">
										{activeWorkspace.branch}
									</span>
									{/* User-owned Default/external workspaces have no ThinkRail creation provenance,
									    so "from <base>" would make a promise the app cannot support. */}
									{isUserOwnedWorkspace(activeWorkspace) ? null : (
										<span data-testid="scope-base" className="hidden shrink-0 md:inline">
											· from {activeWorkspace.baseBranch}
										</span>
									)}
									{openReview ? (
										<span
											data-testid="scope-review"
											data-kind={openReview.kind}
											className="shrink-0"
										>
											· {openReviewLabel(openReview)}
										</span>
									) : null}
								</div>
							) : null}
						</div>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-md">
					<span
						data-testid="connection-status"
						data-status={status}
						role="status"
						aria-label={STATUS_LABEL[status]}
						className="inline-flex items-center gap-sm tr-text-ui text-text-muted"
					>
						<span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
						<span aria-hidden="true" className="hidden sm:inline">
							{STATUS_LABEL[status]}
						</span>
					</span>
					<button
						type="button"
						data-testid="open-settings"
						aria-label="Settings"
						title="Settings"
						onClick={() => useAppStore.getState().openSettings()}
						className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
					>
						<Settings className="size-4" />
					</button>
				</div>
				<SettingsDialog />
			</header>
			{hasActiveWorkspace ? (
				<div
					data-testid="workspace-shell-layout"
					data-left-collapsed={workspaceProjects.collapsed}
					data-right-collapsed={workspaceRight.collapsed}
					className="flex h-full min-h-0 min-w-0"
				>
					{workspaceProjects.collapsed ? (
						<CollapsedPanelRail
							ref={workspaceProjects.railRef}
							side="left"
							label="Projects"
							shortcutKey="B"
							onOpen={workspaceProjects.openAndFocus}
						/>
					) : null}
					<ResizablePanelGroup
						direction="horizontal"
						autoSaveId="thinkrail-shell"
						className="min-h-0 min-w-0 flex-1"
					>
						<ResizablePanel
							ref={workspaceProjects.panelRef}
							id="left"
							order={1}
							defaultSize={18}
							minSize={12}
							collapsedSize={0}
							collapsible
							onCollapse={workspaceProjects.onCollapse}
							onExpand={workspaceProjects.onExpand}
						>
							<aside
								ref={workspaceProjects.contentRef}
								data-testid="left-nav"
								tabIndex={-1}
								aria-hidden={workspaceProjects.collapsed || undefined}
								inert={workspaceProjects.collapsed ? true : undefined}
								className="h-full overflow-auto bg-container-sidebar-bg p-md outline-none"
							>
								<ProjectTree />
							</aside>
						</ResizablePanel>
						<ResizableHandle
							direction="horizontal"
							data-testid="resize-left"
							aria-hidden={workspaceProjects.collapsed}
							tabIndex={workspaceProjects.collapsed ? -1 : 0}
							onDragging={workspaceProjects.onDragging}
							{...(workspaceProjects.collapsed ? { className: "hidden" } : {})}
						/>
						<ResizablePanel id="center" order={2} defaultSize={52} minSize={28}>
							<main
								ref={workspaceCenterRef}
								data-testid="center-tabs"
								tabIndex={-1}
								className="h-full min-h-0 bg-container-content-bg outline-none"
							>
								<ErrorBoundary label="Editor" resetKeys={[activeWorkspaceId]}>
									<CenterTabs />
								</ErrorBoundary>
							</main>
						</ResizablePanel>
						<ResizableHandle
							direction="horizontal"
							data-testid="resize-right"
							aria-hidden={workspaceRight.collapsed}
							tabIndex={workspaceRight.collapsed ? -1 : 0}
							onDragging={workspaceRight.onDragging}
							{...(workspaceRight.collapsed ? { className: "hidden" } : {})}
						/>
						<ResizablePanel
							ref={workspaceRight.panelRef}
							id="right"
							order={3}
							defaultSize={30}
							minSize={16}
							collapsedSize={0}
							collapsible
							onCollapse={workspaceRight.onCollapse}
							onExpand={workspaceRight.onExpand}
						>
							<div
								ref={workspaceRight.contentRef}
								data-testid="right-stack"
								tabIndex={-1}
								aria-hidden={workspaceRight.collapsed || undefined}
								inert={workspaceRight.collapsed ? true : undefined}
								className="h-full min-h-0 outline-none"
							>
								<ResizablePanelGroup direction="vertical" autoSaveId="thinkrail-right">
									<ResizablePanel id="right-files" order={1} defaultSize={60} minSize={20}>
										<div
											data-testid="right-panel"
											className="h-full min-h-0 bg-container-sidebar-bg"
										>
											<ErrorBoundary label="Files" resetKeys={[activeWorkspaceId]}>
												<RightPanel />
											</ErrorBoundary>
										</div>
									</ResizablePanel>
									<ResizableHandle direction="vertical" data-testid="resize-terminals" />
									<ResizablePanel id="right-terminals" order={2} defaultSize={40} minSize={15}>
										<div className="h-full min-h-0 bg-container-terminal-bg">
											<ErrorBoundary label="Terminals" resetKeys={[activeWorkspaceId]}>
												<TerminalsPanel />
											</ErrorBoundary>
										</div>
									</ResizablePanel>
								</ResizablePanelGroup>
							</div>
						</ResizablePanel>
					</ResizablePanelGroup>
					{workspaceRight.collapsed ? (
						<CollapsedPanelRail
							ref={workspaceRight.railRef}
							side="right"
							label="Workspace"
							shortcutKey="J"
							onOpen={workspaceRight.openAndFocus}
						/>
					) : null}
				</div>
			) : (
				// No active workspace — the separately-persisted Welcome layout has only the Projects region.
				<div
					data-testid="welcome-shell-layout"
					data-left-collapsed={welcomeProjects.collapsed}
					className="flex h-full min-h-0 min-w-0"
				>
					{welcomeProjects.collapsed ? (
						<CollapsedPanelRail
							ref={welcomeProjects.railRef}
							side="left"
							label="Projects"
							shortcutKey="B"
							onOpen={welcomeProjects.openAndFocus}
						/>
					) : null}
					<ResizablePanelGroup
						direction="horizontal"
						autoSaveId="thinkrail-shell-welcome"
						className="min-h-0 min-w-0 flex-1"
					>
						<ResizablePanel
							ref={welcomeProjects.panelRef}
							id="left"
							order={1}
							defaultSize={18}
							minSize={12}
							collapsedSize={0}
							collapsible
							onCollapse={welcomeProjects.onCollapse}
							onExpand={welcomeProjects.onExpand}
						>
							<aside
								ref={welcomeProjects.contentRef}
								data-testid="left-nav"
								tabIndex={-1}
								aria-hidden={welcomeProjects.collapsed || undefined}
								inert={welcomeProjects.collapsed ? true : undefined}
								className="h-full overflow-auto bg-container-sidebar-bg p-md outline-none"
							>
								<ProjectTree />
							</aside>
						</ResizablePanel>
						<ResizableHandle
							direction="horizontal"
							data-testid="resize-left"
							aria-hidden={welcomeProjects.collapsed}
							tabIndex={welcomeProjects.collapsed ? -1 : 0}
							onDragging={welcomeProjects.onDragging}
							{...(welcomeProjects.collapsed ? { className: "hidden" } : {})}
						/>
						<ResizablePanel id="welcome" order={2} defaultSize={82} minSize={40}>
							<div
								ref={welcomeCenterRef}
								tabIndex={-1}
								className="h-full min-h-0 bg-container-content-bg outline-none"
							>
								<WelcomePanel />
							</div>
						</ResizablePanel>
					</ResizablePanelGroup>
				</div>
			)}
			<Toaster />
		</div>
	);
}
