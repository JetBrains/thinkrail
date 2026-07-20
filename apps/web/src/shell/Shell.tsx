import { Settings } from "lucide-react";
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
import { useAppStore } from "../store";
import { applyTheme, writeThemeHint } from "../themes";
import type { ConnectionStatus } from "../transport";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	connected: "Connected",
	connecting: "Connecting…",
	disconnected: "Disconnected",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
	connected: "bg-green",
	connecting: "bg-gold",
	disconnected: "bg-red",
};

export function Shell() {
	const status = useAppStore((s) => s.status);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const hasActiveWorkspace = activeWorkspaceId != null;
	// The single owner of the theme DOM side-effect: apply the store's (host-owned) theme + cache it as the
	// next load's first-paint hint. The store is fed by transport (welcome / settings.changed).
	const theme = useAppStore((s) => s.theme);
	useEffect(() => {
		applyTheme(theme);
		writeThemeHint(theme);
	}, [theme]);
	return (
		<div data-testid="shell" className="grid h-full grid-rows-[auto_1fr]">
			<header className="flex items-center justify-between border-b border-border2 bg-bg-dark px-lg py-sm">
				<span className="font-[var(--font-accent)] text-lg font-extrabold tracking-[0.5px] text-primary">
					{PRODUCT_NAME}
				</span>
				<div className="flex items-center gap-md">
					<span
						data-testid="connection-status"
						data-status={status}
						className="inline-flex items-center gap-sm text-sm text-muted"
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
						className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
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
						<aside data-testid="left-nav" className="h-full overflow-auto bg-surface-sidebar p-md">
							<ProjectTree />
						</aside>
					</ResizablePanel>
					<ResizableHandle direction="horizontal" data-testid="resize-left" />
					<ResizablePanel id="center" order={2} defaultSize={52} minSize={28}>
						<main data-testid="center-tabs" className="h-full min-h-0 bg-surface-content">
							<ErrorBoundary label="Editor" resetKeys={[activeWorkspaceId]}>
								<CenterTabs />
							</ErrorBoundary>
						</main>
					</ResizablePanel>
					<ResizableHandle direction="horizontal" data-testid="resize-right" />
					<ResizablePanel id="right" order={3} defaultSize={30} minSize={16}>
						<ResizablePanelGroup direction="vertical" autoSaveId="thinkrail-right">
							<ResizablePanel id="right-files" order={1} defaultSize={60} minSize={20}>
								<div data-testid="right-panel" className="h-full min-h-0 bg-surface-content">
									<ErrorBoundary label="Files" resetKeys={[activeWorkspaceId]}>
										<RightPanel />
									</ErrorBoundary>
								</div>
							</ResizablePanel>
							<ResizableHandle direction="vertical" data-testid="resize-terminals" />
							<ResizablePanel id="right-terminals" order={2} defaultSize={40} minSize={15}>
								<div className="h-full min-h-0 bg-surface-content">
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
						<aside data-testid="left-nav" className="h-full overflow-auto bg-surface-sidebar p-md">
							<ProjectTree />
						</aside>
					</ResizablePanel>
					<ResizableHandle direction="horizontal" data-testid="resize-left" />
					<ResizablePanel id="welcome" order={2} defaultSize={82} minSize={40}>
						<div className="h-full min-h-0 bg-surface-content">
							<WelcomePanel />
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			)}
			<Toaster />
		</div>
	);
}
