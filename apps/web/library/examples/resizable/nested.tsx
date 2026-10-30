import { useT } from "@thinkrail/locales/react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";

export default function Nested() {
	const t = useT();
	return (
		<div className="h-240 w-full">
			<ResizablePanelGroup direction="vertical">
				<ResizablePanel id="main-row" order={1} defaultSize={65} minSize={40}>
					<ResizablePanelGroup direction="horizontal">
						<ResizablePanel id="main-left" order={1} defaultSize={30} minSize={15}>
							<div className="flex h-full items-center justify-center bg-container-sidebar-bg tr-text-ui text-text-muted">
								{t("workbench.tool.projects")}
							</div>
						</ResizablePanel>
						<ResizableHandle />
						<ResizablePanel id="main-center" order={2} defaultSize={70} minSize={40}>
							<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
								{t("workbench.center.group")}
							</div>
						</ResizablePanel>
					</ResizablePanelGroup>
				</ResizablePanel>
				<ResizableHandle direction="vertical" />
				<ResizablePanel id="bottom" order={2} defaultSize={35} minSize={20} maxSize={60}>
					<div className="flex h-full items-center justify-center bg-container-terminal-bg tr-text-ui text-text-muted">
						{t("workbench.rail.terminal")}
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
