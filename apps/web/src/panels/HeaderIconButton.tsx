import { IconTooltip } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";

export function HeaderIconButton({
	testid,
	label,
	active,
	disabled,
	onClick,
	children,
}: {
	testid: string;
	label: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<IconTooltip label={label}>
			<button
				type="button"
				data-testid={testid}
				data-active={active}
				aria-pressed={active}
				aria-label={label}
				disabled={disabled}
				onClick={onClick}
				className={`flex size-24 items-center justify-center rounded-[var(--radius-sm)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text ${
					active
						? "bg-container-elevated-bg text-text-default"
						: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				}`}
			>
				{children}
			</button>
		</IconTooltip>
	);
}
