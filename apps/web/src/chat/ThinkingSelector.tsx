import type { ThinkingLevel } from "@thinkrail-pi/contracts";
import { Brain, Check } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The honest effort knob pi exposes (M14): the six thinking levels. pi clamps any the model can't do. */
const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** The per-session thinking-level picker (cheap win #1). Props-driven, no store. */
export function ThinkingSelector({
	level,
	onSelect,
}: {
	level: ThinkingLevel;
	onSelect: (level: ThinkingLevel) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				data-testid="thinking-selector"
				className="flex h-7 items-center gap-xs rounded-[var(--radius-md)] border border-border2 bg-elevated px-sm text-sm text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary"
			>
				<Brain className="size-3.5 shrink-0 text-muted" />
				<span className="capitalize">{level}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-[8rem]">
				{LEVELS.map((l) => (
					<DropdownMenuItem
						key={l}
						data-testid="thinking-option"
						data-level={l}
						onSelect={() => onSelect(l)}
					>
						<span className="flex-1 capitalize">{l}</span>
						{l === level ? <Check className="size-3.5 text-primary" /> : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
