import type { ThinkingLevel } from "@thinkrail/contracts";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ThinkingSelector({
	level,
	levels,
	onSelect,
	container,
}: {
	level: ThinkingLevel;
	levels: readonly ThinkingLevel[];
	onSelect: (level: ThinkingLevel) => void;
	container?: HTMLElement | null;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				data-testid="thinking-selector"
				data-open={open}
				disabled={levels.length === 0}
				className="flex h-32 items-center gap-8 rounded-[var(--radius-sm)] border border-control-border-default bg-clip-padding bg-control-bg px-8 tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text data-[open=true]:border-control-border-active data-[open=true]:bg-control-bg-selected"
			>
				<span className="tr-text-eyebrow text-text-muted">Effort</span>
				<span className="capitalize">{level}</span>
				<ChevronDown className="size-12 shrink-0 text-text-muted" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[160px] p-4">
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
