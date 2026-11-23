import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";

/** Below this panel width the call details stack under their view: beside it they would get under 290 px. */
const STACK_BELOW = 900;

interface PanelSize {
	defaultSize: number;
	minSize: number;
}

/** A split's view and details sizes, in percent of the group. */
export interface SplitSizes {
	view: PanelSize;
	details: PanelSize;
}

const BESIDE: SplitSizes = {
	view: { defaultSize: 68, minSize: 40 },
	details: { defaultSize: 32, minSize: 22 },
};
const STACKED: SplitSizes = {
	view: { defaultSize: 60, minSize: 25 },
	details: { defaultSize: 40, minSize: 20 },
};

export function stacksDetails(width: number): boolean {
	return width < STACK_BELOW;
}

/**
 * A session view with the call details beside it, or under it when the panel is narrow. The group
 * remounts when it turns, so each direction starts from its own sizes.
 */
export function DetailsSplit({
	stacked,
	view,
	details,
	sizes,
	className = "h-full min-h-0",
	testId,
}: {
	stacked: boolean;
	view: ReactNode;
	details: ReactNode;
	/** The same sizes in both directions; by default the details take less room beside than under. */
	sizes?: SplitSizes;
	className?: string;
	testId?: string;
}) {
	const size = sizes ?? (stacked ? STACKED : BESIDE);
	const direction = stacked ? "vertical" : "horizontal";
	return (
		<ResizablePanelGroup key={direction} direction={direction} className={className}>
			<ResizablePanel {...size.view}>{view}</ResizablePanel>
			<ResizableHandle direction={direction} />
			<ResizablePanel {...size.details}>
				<div
					data-testid={testId}
					data-stacked={stacked ? "true" : undefined}
					className={cn("h-full min-h-0 border-border-default", stacked ? "border-t" : "border-l")}
				>
					{details}
				</div>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
