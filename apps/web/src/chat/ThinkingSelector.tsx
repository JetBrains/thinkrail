import type { ThinkingLevel } from "@thinkrail/contracts";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The per-session effort picker: a pill opening the levels the active model actually supports — the same
 * trigger+popover shape as the model picker. Props-driven, no store — shared by the chat composer and
 * the New-Workspace dialog.
 */
export function ThinkingSelector({
	level,
	levels,
	onSelect,
	container,
}: {
	level: ThinkingLevel;
	/** The active model's selectable levels, straight from `WireModel.thinkingLevels` (already in pi's
	 * escalation order). Empty until a model resolves, which disables the trigger. */
	levels: readonly ThinkingLevel[];
	onSelect: (level: ThinkingLevel) => void;
	/** Popover portal target — the host Dialog node when used inside a dialog (so the list scrolls). */
	container?: HTMLElement | null;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				data-testid="thinking-selector"
				data-open={open}
				disabled={levels.length === 0}
				className="flex h-8 items-center gap-sm rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm text-sm text-text outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 data-[open=true]:border-[var(--primary-60)] data-[open=true]:bg-hover"
			>
				<span className="text-hint text-xs uppercase tracking-wider">Effort</span>
				<span className="capitalize">{level}</span>
				<ChevronDown className="size-3 shrink-0 text-hint" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[160px] p-xs">
				{levels.map((l) => (
					<button
						key={l}
						type="button"
						data-testid="thinking-option"
						data-level={l}
						aria-pressed={l === level}
						onClick={() => {
							onSelect(l);
							setOpen(false);
						}}
						className="flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs text-left text-sm text-text capitalize outline-none transition-colors hover:bg-hover"
					>
						<span className="flex w-3.5 shrink-0 justify-center">
							{l === level ? <Check className="size-3.5 text-primary" /> : null}
						</span>
						{l}
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}
