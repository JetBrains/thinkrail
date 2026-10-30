import { useT } from "@thinkrail/locales/react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";

export default function ThreeColumns() {
	const t = useT();
	return (
		<div className="h-160 w-full">
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel
					id="layout-left"
					order={1}
					defaultSize={25}
					minSize={15}
					collapsedSize={0}
					collapsible
				>
					<div className="flex h-full items-center justify-center bg-container-sidebar-bg tr-text-ui text-text-muted">
						{t("workbench.tool.projects")}
					</div>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="layout-center" order={2} defaultSize={50} minSize={30}>
					<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
						{t("workbench.center.group")}
					</div>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel
					id="layout-right"
					order={3}
					defaultSize={25}
					minSize={15}
					collapsedSize={0}
					collapsible
				>
					<div className="flex h-full items-center justify-center bg-container-sidebar-bg tr-text-ui text-text-muted">
						{t("workbench.tool.review")}
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
