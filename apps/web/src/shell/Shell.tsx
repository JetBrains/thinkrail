import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { PRODUCT_NAME } from "../constants/branding";
import { CenterTabs } from "../panels/CenterTabs";
import { ProjectTree } from "../panels/ProjectTree";
import { RightPanel } from "../panels/RightPanel";
import { TerminalsPanel } from "../panels/TerminalsPanel";
import { useAppStore } from "../store/appStore";
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
	return (
		<div data-testid="shell" className="grid h-full grid-rows-[auto_1fr]">
			<header className="flex items-center justify-between border-b border-border2 bg-bg-dark px-lg py-sm">
				<span className="font-[var(--font-accent)] text-lg font-extrabold tracking-[0.5px] text-primary">
					{PRODUCT_NAME}
				</span>
				<span
					data-testid="connection-status"
					data-status={status}
					className="inline-flex items-center gap-sm text-sm text-muted"
				>
					<span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
					{STATUS_LABEL[status]}
				</span>
			</header>
			<ResizablePanelGroup direction="horizontal" autoSaveId="thinkrail-shell" className="min-h-0">
				<ResizablePanel id="left" order={1} defaultSize={18} minSize={12}>
					<aside data-testid="left-nav" className="h-full overflow-auto p-md">
						<ProjectTree />
					</aside>
				</ResizablePanel>
				<ResizableHandle direction="horizontal" data-testid="resize-left" />
				<ResizablePanel id="center" order={2} defaultSize={52} minSize={28}>
					<main data-testid="center-tabs" className="h-full min-h-0">
						<CenterTabs />
					</main>
				</ResizablePanel>
				<ResizableHandle direction="horizontal" data-testid="resize-right" withHandle />
				<ResizablePanel id="right" order={3} defaultSize={30} minSize={16}>
					<ResizablePanelGroup direction="vertical" autoSaveId="thinkrail-right">
						<ResizablePanel id="right-files" order={1} defaultSize={60} minSize={20}>
							<div data-testid="right-panel" className="h-full min-h-0">
								<RightPanel />
							</div>
						</ResizablePanel>
						<ResizableHandle direction="vertical" data-testid="resize-terminals" withHandle />
						<ResizablePanel id="right-terminals" order={2} defaultSize={40} minSize={15}>
							<div className="h-full min-h-0">
								<TerminalsPanel />
							</div>
						</ResizablePanel>
					</ResizablePanelGroup>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
