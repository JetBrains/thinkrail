import {
	RiCheckboxBlankLine,
	RiCheckboxMultipleBlankLine,
	RiCloseLine,
	RiSubtractLine,
} from "@remixicon/react";
import type { NativeWindowState } from "@thinkrail/contracts";
import { cn } from "@/lib/utils";

const BUTTON_CLASS =
	"flex h-topbar-row w-46 items-center justify-center text-text-muted outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";
const BUTTON_HOVER_CLASS = "hover:bg-control-bg-hovered hover:text-text-default";
const CLOSE_HOVER_CLASS = "hover:bg-feedback-error-subtle hover:text-feedback-error";

export function NativeWindowControls({
	state,
	onMinimize,
	onToggleMaximize,
	onClose,
}: {
	state: NativeWindowState;
	onMinimize(): void;
	onToggleMaximize(): void;
	onClose(): void;
}) {
	if (state.fullScreen) return null;
	const MaximizeIcon = state.maximized ? RiCheckboxMultipleBlankLine : RiCheckboxBlankLine;
	return (
		<div
			data-testid="window-controls"
			className="window-no-drag absolute top-0 right-0 flex h-topbar-row"
		>
			<button
				type="button"
				data-testid="window-minimize"
				aria-label="Minimize"
				onClick={onMinimize}
				className={cn(BUTTON_CLASS, BUTTON_HOVER_CLASS)}
			>
				<RiSubtractLine className="size-16" />
			</button>
			<button
				type="button"
				data-testid="window-maximize"
				aria-label={state.maximized ? "Restore" : "Maximize"}
				data-maximized={state.maximized}
				onClick={onToggleMaximize}
				className={cn(BUTTON_CLASS, BUTTON_HOVER_CLASS)}
			>
				<MaximizeIcon className="size-16" />
			</button>
			<button
				type="button"
				data-testid="window-close"
				aria-label="Close"
				onClick={onClose}
				className={cn(BUTTON_CLASS, CLOSE_HOVER_CLASS)}
			>
				<RiCloseLine className="size-16" />
			</button>
		</div>
	);
}
