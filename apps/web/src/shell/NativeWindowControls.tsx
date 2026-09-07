import {
	RiCloseLine as Close,
	RiCheckboxBlankLine as Maximize,
	RiSubtractLine as Minimize,
	RiCheckboxMultipleBlankLine as Restore,
} from "@remixicon/react";
import { IconTooltip } from "../components/ui/tooltip";
import type { NativeWindowChromeAdapter } from "../nativeWindowChrome";

const commonButtonClass =
	"flex items-center justify-center text-text-muted outline-none transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

export function NativeWindowControls({
	adapter,
	maximized,
}: {
	adapter: NativeWindowChromeAdapter;
	maximized: boolean;
}) {
	if (adapter.platform === "macos") return null;
	const linux = adapter.platform === "linux";
	const MaximizeIcon = maximized ? Restore : Maximize;
	const maximizeLabel = maximized ? "Restore window" : "Maximize window";
	const buttonClass = `${commonButtonClass} ${linux ? "size-28 rounded-full bg-control-bg-hovered hover:bg-control-bg-selected" : "h-[48px] w-40 hover:bg-control-bg-hovered"}`;
	return (
		<div
			data-testid="window-controls"
			data-platform={adapter.platform}
			className={`electrobun-webkit-app-region-no-drag -my-8 flex h-[48px] ${linux ? "-mr-8 items-center gap-8 pl-4 pr-8" : "-mr-16 border-l border-border-default"}`}
		>
			<IconTooltip label="Minimize window">
				<button
					type="button"
					data-testid="window-minimize"
					aria-label="Minimize window"
					onClick={adapter.minimize}
					className={buttonClass}
				>
					<Minimize className="size-14" />
				</button>
			</IconTooltip>
			<IconTooltip label={maximizeLabel}>
				<button
					type="button"
					data-testid="window-toggle-maximize"
					aria-label={maximizeLabel}
					onClick={adapter.toggleMaximize}
					className={buttonClass}
				>
					<MaximizeIcon className="size-14" />
				</button>
			</IconTooltip>
			<IconTooltip label="Close window">
				<button
					type="button"
					data-testid="window-close"
					aria-label="Close window"
					onClick={adapter.requestClose}
					className={`${buttonClass} hover:bg-feedback-error hover:text-text-on-primary`}
				>
					<Close className="size-14" />
				</button>
			</IconTooltip>
		</div>
	);
}
