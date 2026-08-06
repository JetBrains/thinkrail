import { ChevronRight, GitBranch, Settings } from "lucide-react";
import { useEffect } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { PRODUCT_NAME } from "../constants/branding";
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
import { useGlobalHotkeys } from "./useGlobalHotkeys";

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
	const hasActiveWorkspace = activeWorkspaceId != null;
	// The single owner of the theme DOM side-effect: apply the store's (host-owned) theme + cache it as the
	// next load's first-paint hint. The store is fed by transport (welcome / settings.changed).
	const theme = useAppStore((s) => s.theme);
	useEffect(() => {
		applyTheme(theme);
		writeThemeHint(theme);
	}, [theme]);
	// App-wide chords the browser would otherwise take (`Ctrl+R` → history search, not a reload).
	useGlobalHotkeys();
	return (
		<div data-testid="shell" className="grid h-full grid-rows-[auto_1fr]">
			<header className="flex items-center justify-between border-b border-border-default bg-container-header-bg px-lg py-sm">
				<div className="flex min-w-0 items-center gap-md">
					<span className="tr-brand-wordmark shrink-0 text-primary">{PRODUCT_NAME}</span>
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
								</div>
							) : null}
						</div>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-md">
					<span
						data-testid="connection-status"
						data-status={status}
						className="inline-flex items-center gap-sm tr-text-ui text-text-muted"
					>
						<span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
						{STATUS_LABEL[status]}
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
				<ResizablePanelGroup
					direction="horizontal"
					autoSaveId="thinkrail-shell"
					className="min-h-0"
				>
					<ResizablePanel id="left" order={1} defaultSize={18} minSize={12}>
						<aside
							data-testid="left-nav"
							className="h-full overflow-auto bg-container-sidebar-bg p-md"
						>
							<ProjectTree />
						</aside>
					</ResizablePanel>
					<ResizableHandle direction="horizontal" data-testid="resize-left" />
					<ResizablePanel id="center" order={2} defaultSize={52} minSize={28}>
						<main data-testid="center-tabs" className="h-full min-h-0 bg-container-content-bg">
							<ErrorBoundary label="Editor" resetKeys={[activeWorkspaceId]}>
								<CenterTabs />
							</ErrorBoundary>
						</main>
					</ResizablePanel>
					<ResizableHandle direction="horizontal" data-testid="resize-right" />
					<ResizablePanel id="right" order={3} defaultSize={30} minSize={16}>
						<ResizablePanelGroup direction="vertical" autoSaveId="thinkrail-right">
							<ResizablePanel id="right-files" order={1} defaultSize={60} minSize={20}>
								<div data-testid="right-panel" className="h-full min-h-0 bg-container-sidebar-bg">
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
					</ResizablePanel>
				</ResizablePanelGroup>
			) : (
				// No active workspace — hide the center/right/terminal surface; show the Welcome screen beside the
				// (still resizable) projects rail. A distinct autoSaveId keeps the 3-column layout's saved sizes.
				<ResizablePanelGroup
					direction="horizontal"
					autoSaveId="thinkrail-shell-welcome"
					className="min-h-0"
				>
					<ResizablePanel id="left" order={1} defaultSize={18} minSize={12}>
						<aside
							data-testid="left-nav"
							className="h-full overflow-auto bg-container-sidebar-bg p-md"
						>
							<ProjectTree />
						</aside>
					</ResizablePanel>
					<ResizableHandle direction="horizontal" data-testid="resize-left" />
					<ResizablePanel id="welcome" order={2} defaultSize={82} minSize={40}>
						<div className="h-full min-h-0 bg-container-content-bg">
							<WelcomePanel />
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			)}
			<Toaster />
		</div>
	);
}
