import { useT } from "@thinkrail/locales/react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";

export default function DisabledHandle() {
	const t = useT();
	return (
		<div className="h-160 w-full">
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel id="center-split-0" order={1} defaultSize={50} minSize={4}>
					<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
						{t("store.chatTab.defaultName")}
					</div>
				</ResizablePanel>
				<ResizableHandle disabled />
				<ResizablePanel id="center-split-1" order={2} defaultSize={50} minSize={4}>
					<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
						{t("store.chatTab.defaultName")}
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
