import {
	RiLayoutLeftLine as PanelLeftOpen,
	RiLayoutRightLine as PanelRightOpen,
} from "@remixicon/react";
import { forwardRef } from "react";
import { cn, platformShortcutLabel } from "../lib";

type CollapsedPanelRailProps = {
	side: "left" | "right";
	label: "Projects" | "Workspace";
	shortcutKey: "B" | "J";
	onOpen: () => void;
};

export const CollapsedPanelRail = forwardRef<HTMLButtonElement, CollapsedPanelRailProps>(
	function CollapsedPanelRail({ side, label, shortcutKey, onOpen }, ref) {
		const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
		const shortcut = platformShortcutLabel(shortcutKey);
		const accessibleLabel = `Open ${label} (${shortcut})`;
		return (
			<button
				ref={ref}
				type="button"
				data-testid={`collapsed-${side}-rail`}
				aria-label={accessibleLabel}
				title={accessibleLabel}
				onClick={onOpen}
				className={cn(
					"flex h-full w-28 shrink-0 flex-col items-center gap-12 bg-container-sidebar-bg pt-4 text-text-muted outline-none transition-colors",
					"hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
					side === "left" ? "border-border-default border-r" : "border-border-default border-l",
				)}
			>
				<Icon aria-hidden="true" className="size-14 shrink-0" />
				<span aria-hidden="true" className="rotate-180 [writing-mode:vertical-rl] tr-text-eyebrow">
					{label}
				</span>
			</button>
		);
	},
);
