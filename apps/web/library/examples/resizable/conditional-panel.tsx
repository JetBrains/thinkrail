import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { useState } from "react";

export default function ConditionalPanel() {
	const t = useT();
	const [bottomVisible, setBottomVisible] = useState(true);
	return (
		<div className="flex w-full flex-col gap-8">
			<Button
				variant="outline"
				size="m"
				className="self-start"
				selected={bottomVisible}
				aria-pressed={bottomVisible}
				onClick={() => setBottomVisible((visible) => !visible)}
			>
				{t("workbench.rail.terminal")}
			</Button>
			<div className="h-240 w-full">
				<ResizablePanelGroup direction="vertical">
					<ResizablePanel
						id="layout-main-row"
						order={1}
						defaultSize={bottomVisible ? 65 : 100}
						minSize={40}
					>
						<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
							{t("workbench.center.group")}
						</div>
					</ResizablePanel>
					{bottomVisible ? (
						<>
							<ResizableHandle direction="vertical" />
							<ResizablePanel
								id="layout-bottom"
								order={2}
								defaultSize={35}
								minSize={20}
								maxSize={60}
							>
								<div className="flex h-full items-center justify-center bg-container-terminal-bg tr-text-ui text-text-muted">
									{t("workbench.rail.terminal")}
								</div>
							</ResizablePanel>
						</>
					) : null}
				</ResizablePanelGroup>
			</div>
		</div>
	);
}
