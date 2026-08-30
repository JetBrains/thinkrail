import {
	RiArrowRightSLine as ChevronRight,
	RiCircleLine as Circle,
	RiGitBranchLine as GitBranch,
	RiCircleFill,
	RiSettings3Line as Settings,
} from "@remixicon/react";
import { useEffect, useRef } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { IconTooltip } from "../components/ui/tooltip";
import { ProjectTree } from "../panels/ProjectTree";
import { SettingsDialog } from "../panels/SettingsDialog";
import { Toaster } from "../panels/Toaster";
import { openReviewLabel, useOpenBranchReview } from "../panels/useOpenBranchReview";
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
import { LayoutSettings } from "./LayoutSettings";
import { useLocalLayoutState } from "./layoutState";
import { useCollapsibleRegion } from "./useCollapsibleRegion";
import { useGlobalHotkeys } from "./useGlobalHotkeys";
import { WorkspaceWorkbench } from "./WorkspaceWorkbench";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	connected: "Connected",
	connecting: "Connecting…",
	disconnected: "Disconnected",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
	connected: "text-feedback-success",
	connecting: "text-feedback-warning",
	disconnected: "text-feedback-error",
};

export function Shell() {
	useLocalLayoutState();
	const status = useAppStore((s) => s.status);
	const StatusDot = status === "connected" ? RiCircleFill : Circle;
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const contextProject = useAppStore(selectContextProject);
	const { review: openReview } = useOpenBranchReview(activeWorkspace, status);
	const hasActiveWorkspace = activeWorkspaceId != null;

	const welcomeCenterRef = useRef<HTMLDivElement>(null);
	const welcomeProjects = useCollapsibleRegion(welcomeCenterRef, "welcome-left");

	const theme = useAppStore((s) => s.theme);
	useEffect(() => {
		applyTheme(theme);
		writeThemeHint(theme);
	}, [theme]);
	useGlobalHotkeys({
		onProjects: hasActiveWorkspace
			? () => {
					if (!activeWorkspaceId) return;
					useAppStore.getState().enqueueLayoutIntent({
						kind: "toggle-side",
						workspaceId: activeWorkspaceId,
						side: "left",
					});
				}
			: welcomeProjects.focusOrCollapse,
		...(hasActiveWorkspace
			? {
					onWorkspace: () => {
						if (!activeWorkspaceId) return;
						useAppStore.getState().enqueueLayoutIntent({
							kind: "toggle-side",
							workspaceId: activeWorkspaceId,
							side: "right",
						});
					},
					onBottom: () => {
						if (!activeWorkspaceId) return;
						useAppStore.getState().enqueueLayoutIntent({
							kind: "toggle-bottom",
							workspaceId: activeWorkspaceId,
						});
					},
				}
			: {}),
	});
	return (
		<div data-testid="shell" className="grid h-full grid-rows-[auto_1fr]">
			<header className="flex items-center justify-between border-b border-border-default bg-container-header-bg px-16 py-8">
				<div className="flex min-w-0 items-center gap-12">
					<BrandLogo />
					{contextProject ? (
						<div
							data-testid="scope-context"
							data-context={activeWorkspace ? "workspace" : "project-home"}
							className="flex min-w-0 items-center gap-4 leading-tight tr-text-ui"
						>
							<span className="hidden min-w-0 items-center gap-4 sm:flex">
								<span
									data-testid="scope-project"
									className="max-w-[160px] truncate text-text-default"
								>
									{contextProject.name}
								</span>
								<ChevronRight className="size-16 shrink-0 text-text-muted" />
							</span>
							<span data-testid="scope-name" className="max-w-[220px] truncate text-text-default">
								{activeWorkspace?.name ?? "Project home"}
							</span>
							{activeWorkspace ? (
								<>
									<GitBranch className="size-14 shrink-0 text-text-muted" />
									<span data-testid="scope-branch" className="truncate text-text-muted">
										{activeWorkspace.branch}
									</span>
									{isUserOwnedWorkspace(activeWorkspace) ? null : (
										<span
											data-testid="scope-base"
											className="hidden shrink-0 text-text-muted md:inline"
										>
											· from {activeWorkspace.baseBranch}
										</span>
									)}
									{openReview ? (
										<span
											data-testid="scope-review"
											data-kind={openReview.kind}
											className="shrink-0 text-text-muted"
										>
											· {openReviewLabel(openReview)}
										</span>
									) : null}
								</>
							) : null}
						</div>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-12">
					<span
						data-testid="connection-status"
						data-status={status}
						role="status"
						aria-label={STATUS_LABEL[status]}
						className="inline-flex items-center gap-8 tr-text-ui text-text-muted"
					>
						<StatusDot
							aria-hidden="true"
							className={`size-8 shrink-0 fill-current ${STATUS_DOT[status]}`}
						/>
						<span aria-hidden="true" className="hidden sm:inline">
							{STATUS_LABEL[status]}
						</span>
					</span>
					<IconTooltip label="Settings">
						<button
							type="button"
							data-testid="open-settings"
							aria-label="Settings"
							onClick={() => useAppStore.getState().openSettings()}
							className="flex size-28 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
						>
							<Settings className="size-16" />
						</button>
					</IconTooltip>
				</div>
				<SettingsDialog layoutSettings={<LayoutSettings />} />
			</header>
			{hasActiveWorkspace && activeWorkspaceId ? (
				<div data-testid="workspace-shell-layout" className="h-full min-h-0 min-w-0">
					<WorkspaceWorkbench key={activeWorkspaceId} workspaceId={activeWorkspaceId} />
				</div>
			) : (
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
								className="h-full overflow-auto bg-container-sidebar-bg p-12 outline-none"
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
