import { useT } from "@thinkrail/locales/react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";

export default function VerticalStack() {
	const t = useT();
	return (
		<div className="h-240 w-full max-w-[16rem]">
			<ResizablePanelGroup direction="vertical">
				<ResizablePanel defaultSize={50} minSize={20}>
					<div className="flex h-full items-center justify-center bg-container-sidebar-bg tr-text-ui text-text-muted">
						{t("workbench.tool.specs")}
					</div>
				</ResizablePanel>
				<ResizableHandle direction="vertical" />
				<ResizablePanel defaultSize={50} minSize={20}>
					<div className="flex h-full items-center justify-center bg-container-sidebar-bg tr-text-ui text-text-muted">
						{t("workbench.tool.files")}
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
