import { useT } from "@thinkrail/locales/react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";

export default function Preview() {
	const t = useT();
	return (
		<div className="h-160 w-full">
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel defaultSize={30} minSize={20}>
					<div className="flex h-full items-center justify-center bg-container-sidebar-bg tr-text-ui text-text-muted">
						{t("workbench.tool.projects")}
					</div>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel defaultSize={70} minSize={40}>
					<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
						{t("workbench.center.group")}
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
