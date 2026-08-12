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
					<span aria-hidden="true" className="inline-flex h-9 shrink-0 items-center text-primary">
						<svg
							viewBox="0 0 556.36 449.2"
							fill="currentColor"
							aria-hidden="true"
							className="block h-full w-auto"
						>
							<path d="m 460.1 294.06 l -2.04 -3.26 c 7.4 -6.37 13.71 -13.31 18.99 -20.72 c 15.49 -21.7 22.25 -47.43 22.13 -74.72 l -0.07 -15.38 c 0.64 -6.21 0.89 -9.98 0.89 -9.98 l -0.02 -71.65 c -0.02 -54.32 -44.07 -98.35 -98.39 -98.35 h -61.59 v 31.11 c 0 4.91 3.98 8.89 8.89 8.89 l 50.02 0.78 c 34.18 0.39 61.81 27.98 62.22 62.17 l 1.07 88.19 c 0.43 28.75 -0.16 67.01 -62.89 86.49 l 104.13 171.57 h 52.92 l -55.98 -90.56 Z m -85.96 -44.06 c 30.95 0 56.02 -25.11 55.98 -56.05 l -0.12 -82.65 c 0 -22.81 -18.49 -41.3 -41.3 -41.3 h -208.7 v 31.775 c 0 4.543 3.682 8.225 8.225 8.225 h 186.645 c 8.356 0 15.13 6.774 15.13 15.13 v 63.87 c 0 9.542 -7.808 17.35 -17.35 17.35 h -60.79 c -57.12 0 -81.27 15.75 -88.22 21.54 c -0.9 0.76 -2.28 0.12 -2.29 -1.07 l -0.921 -79.961 c -0.044 -3.801 -3.138 -6.859 -6.938 -6.859 h -33.491 v 309.2 h 40 v -127.96 c 0 -43.97 24.37 -71.24 79.74 -71.24 Z m -233.57 -180 h -140.57 v 40 h 110 v 339.2 h 40 v -369.77 c 0 -5.21 -4.22 -9.43 -9.43 -9.43 Z m 169.43 -38.12 v -31.88 h -310 v 40 h 301.88 c 4.49 0 8.12 -3.64 8.12 -8.12 Z m 41.9 248.12 h -63.24 c -21.87 0 -39.61 17.74 -39.61 39.61 v 129.59 h 40.06 l 0.62 -108.59 c 0.06 -11.4 9.32 -20.61 20.72 -20.61 h 23.39 c 3.84 0 7.42 1.95 9.5 5.18 l 79.72 124.02 h 45.34 l -96.56 -158.01 c -4.25 -6.95 -11.8 -11.19 -19.94 -11.19 Z" />
						</svg>
					</span>
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
