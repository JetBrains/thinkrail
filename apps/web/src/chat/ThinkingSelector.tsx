import { RiCheckLine as Check, RiArrowDownSLine as ChevronDown } from "@remixicon/react";
import type { ThinkingLevel } from "@thinkrail/contracts";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib";

export function ThinkingSelector({
	level,
	levels,
	onSelect,
	container,
	className,
	showLabel = true,
	disabled = false,
}: {
	level: ThinkingLevel;
	levels: readonly ThinkingLevel[];
	onSelect: (level: ThinkingLevel) => void | Promise<void>;
	container?: HTMLElement | null;
	className?: string;
	showLabel?: boolean;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const select = async (next: ThinkingLevel) => {
		if (disabled) return;
		try {
			await onSelect(next);
			setOpen(false);
		} catch {
			return;
		}
	};
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				if (disabled && next) return;
				setOpen(next);
			}}
		>
			<PopoverTrigger
				data-testid="thinking-selector"
				data-open={open}
				disabled={disabled || levels.length === 0}
				className={cn(
					"flex h-32 items-center gap-8 rounded-[var(--radius-sm)] border border-control-border-default bg-clip-padding bg-control-bg px-8 tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text data-[open=true]:border-control-border-active data-[open=true]:bg-control-bg-selected",
					className,
				)}
			>
				{showLabel ? <span className="tr-text-eyebrow text-text-muted">Effort</span> : null}
				<span className="capitalize">{level}</span>
				<ChevronDown className="size-16 shrink-0 text-text-muted" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[160px] p-4">
				{levels.map((l) => (
					<button
						key={l}
						type="button"
						data-testid="thinking-option"
						data-level={l}
						aria-pressed={l === level}
						disabled={disabled}
						onClick={() => void select(l)}
						className="flex w-full items-center gap-8 rounded-[var(--radius-sm)] px-8 py-4 text-left tr-text-ui text-text-default capitalize outline-none transition-colors hover:bg-control-bg-hovered"
					>
						<span className="flex w-14 shrink-0 justify-center">
							{l === level ? <Check className="size-14 text-primary" /> : null}
						</span>
						{l}
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}
