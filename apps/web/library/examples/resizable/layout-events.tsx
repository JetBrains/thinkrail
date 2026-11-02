import { useT } from "@thinkrail/locales/react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { useRef, useState } from "react";

export default function LayoutEvents() {
	const t = useT();
	const latest = useRef<number[]>([30, 70]);
	const [committed, setCommitted] = useState<number[]>([30, 70]);
	const commit = () => setCommitted(latest.current.map(Math.round));
	return (
		<div className="h-160 w-full">
			<ResizablePanelGroup
				direction="horizontal"
				onLayout={(layout) => {
					latest.current = layout;
				}}
			>
				<ResizablePanel defaultSize={30} minSize={15}>
					<div className="flex h-full items-center justify-center bg-container-sidebar-bg tr-text-ui text-text-muted">
						{t("workbench.tool.files")} · {committed[0]}%
					</div>
				</ResizablePanel>
				<ResizableHandle
					onDragging={(dragging) => {
						if (!dragging) commit();
					}}
					onKeyUpCapture={commit}
				/>
				<ResizablePanel defaultSize={70} minSize={40}>
					<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
						{t("workbench.center.group")} · {committed[1]}%
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
