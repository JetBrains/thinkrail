import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	type ImperativePanelHandle,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@thinkrail/ui/resizable";
import { useRef, useState } from "react";

export default function CollapsiblePane() {
	const t = useT();
	const panelRef = useRef<ImperativePanelHandle>(null);
	const [collapsed, setCollapsed] = useState(false);
	const toggle = () => {
		if (collapsed) panelRef.current?.expand();
		else panelRef.current?.collapse();
	};
	return (
		<div className="flex w-full flex-col gap-8">
			<Button
				variant="outline"
				size="m"
				className="self-start"
				selected={!collapsed}
				aria-pressed={!collapsed}
				aria-controls="library-projects-pane"
				onClick={toggle}
			>
				{t("workbench.tool.projects")}
			</Button>
			<div className="h-160 w-full">
				<ResizablePanelGroup direction="horizontal">
					<ResizablePanel
						ref={panelRef}
						id="left"
						order={1}
						defaultSize={30}
						minSize={15}
						collapsedSize={0}
						collapsible
						onCollapse={() => setCollapsed(true)}
						onExpand={() => setCollapsed(false)}
					>
						<section
							id="library-projects-pane"
							aria-label={t("shell.projectHome.projects")}
							aria-hidden={collapsed || undefined}
							inert={collapsed ? true : undefined}
							className="flex h-full items-center justify-center bg-container-sidebar-bg tr-text-ui text-text-muted"
						>
							{t("shell.projectHome.projects")}
						</section>
					</ResizablePanel>
					<ResizableHandle
						aria-hidden={collapsed}
						tabIndex={collapsed ? -1 : 0}
						{...(collapsed ? { className: "hidden" } : {})}
					/>
					<ResizablePanel id="welcome" order={2} defaultSize={70} minSize={40}>
						<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
							{t("workbench.center.group")}
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
		</div>
	);
}
