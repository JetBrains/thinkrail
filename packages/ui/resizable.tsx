import type { ComponentProps } from "react";
import {
	type ImperativePanelGroupHandle,
	type ImperativePanelHandle,
	Panel,
	PanelGroup,
	PanelResizeHandle,
} from "react-resizable-panels";
import { cn } from "./utils";

export function ResizablePanelGroup({ className, ...props }: ComponentProps<typeof PanelGroup>) {
	return (
		<PanelGroup
			className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
			{...props}
		/>
	);
}

export type { ImperativePanelGroupHandle, ImperativePanelHandle };
export const ResizablePanel = Panel;

export function ResizableHandle({
	direction = "horizontal",
	hitAreaMargins = { coarse: 15, fine: 1 },
	className,
	...props
}: ComponentProps<typeof PanelResizeHandle> & {
	direction?: "horizontal" | "vertical";
}) {
	const isVertical = direction === "vertical";
	return (
		<PanelResizeHandle
			aria-orientation={isVertical ? "horizontal" : "vertical"}
			hitAreaMargins={hitAreaMargins}
			className={cn(
				"relative z-10 shrink-0 before:absolute before:bg-border-default before:transition-colors before:content-['']",
				"data-[resize-handle-state=hover]:before:bg-primary data-[resize-handle-state=drag]:before:bg-primary",
				isVertical
					? "-mb-8 h-9 w-full cursor-row-resize before:inset-x-0 before:top-0 before:h-px"
					: "-mr-8 w-9 cursor-col-resize before:inset-y-0 before:left-0 before:w-px",
				className,
			)}
			{...props}
		/>
	);
}
