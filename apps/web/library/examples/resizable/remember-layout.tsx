import { useT } from "@thinkrail/locales/react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";

export default function RememberLayout() {
	const t = useT();
	return (
		<div className="h-160 w-full">
			<ResizablePanelGroup direction="horizontal" autoSaveId="library-resizable-remember">
				<ResizablePanel id="left" order={1} defaultSize={30} minSize={15}>
					<div className="flex h-full items-center justify-center bg-container-sidebar-bg tr-text-ui text-text-muted">
						{t("shell.projectHome.projects")}
					</div>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="welcome" order={2} defaultSize={70} minSize={40}>
					<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
						{t("workbench.center.group")}
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
