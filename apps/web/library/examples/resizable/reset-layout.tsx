import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	type ImperativePanelGroupHandle,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@thinkrail/ui/resizable";
import { useRef } from "react";

const DEFAULT_LAYOUT = [25, 50, 25];

export default function ResetLayout() {
	const t = useT();
	const groupRef = useRef<ImperativePanelGroupHandle>(null);
	return (
		<div className="flex w-full flex-col gap-8">
			<Button
				variant="outline"
				size="m"
				className="self-start"
				onClick={() => groupRef.current?.setLayout(DEFAULT_LAYOUT)}
			>
				{t("workbench.layoutSettings.resetToDefault")}
			</Button>
			<div className="h-160 w-full">
				<ResizablePanelGroup ref={groupRef} direction="horizontal">
					<ResizablePanel defaultSize={DEFAULT_LAYOUT[0]} minSize={10}>
						<div className="flex h-full items-center justify-center bg-container-sidebar-bg tr-text-ui text-text-muted">
							{t("workbench.tool.projects")}
						</div>
					</ResizablePanel>
					<ResizableHandle />
					<ResizablePanel defaultSize={DEFAULT_LAYOUT[1]} minSize={30}>
						<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
							{t("workbench.center.group")}
						</div>
					</ResizablePanel>
					<ResizableHandle />
					<ResizablePanel defaultSize={DEFAULT_LAYOUT[2]} minSize={10}>
						<div className="flex h-full items-center justify-center bg-container-sidebar-bg tr-text-ui text-text-muted">
							{t("workbench.tool.review")}
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
		</div>
	);
}
