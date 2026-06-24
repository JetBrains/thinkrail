import { GripVertical } from "lucide-react";
import type { ComponentProps } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { cn } from "@/lib";

export function ResizablePanelGroup({ className, ...props }: ComponentProps<typeof PanelGroup>) {
	return (
		<PanelGroup
			className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
			{...props}
		/>
	);
}

export const ResizablePanel = Panel;

/**
 * A draggable divider between panels. `direction` matches the parent group's: a horizontal group gets a
 * vertical (1px-wide) handle, a vertical group a horizontal one. Highlights on hover/drag via tokens.
 */
export function ResizableHandle({
	direction = "horizontal",
	withHandle = false,
	className,
	...props
}: ComponentProps<typeof PanelResizeHandle> & {
	direction?: "horizontal" | "vertical";
	withHandle?: boolean;
}) {
	const isVertical = direction === "vertical";
	return (
		<PanelResizeHandle
			className={cn(
				"relative flex shrink-0 items-center justify-center bg-border2 transition-colors",
				"data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary",
				isVertical
					? "h-px w-full cursor-row-resize after:absolute after:inset-x-0 after:top-1/2 after:h-2 after:-translate-y-1/2 after:content-['']"
					: "w-px cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 after:content-['']",
				className,
			)}
			{...props}
		>
			{withHandle && (
				<div className="z-10 flex items-center justify-center rounded-[var(--radius-sm)] border border-border2 bg-elevated px-px py-0.5">
					<GripVertical className={cn("size-2.5 text-hint", isVertical && "rotate-90")} />
				</div>
			)}
		</PanelResizeHandle>
	);
}
