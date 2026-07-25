import type { ThinkingLevel } from "@thinkrail/contracts";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** The honest effort knob pi exposes: the seven thinking levels, in pi's escalation order. */
const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Snap a desired level onto a model's supported set: keep it if supported, else nearest supported —
 * upward first, then downward. A deliberate MIRROR of pi-ai `clampThinkingLevel`'s direction (the web
 * cannot value-import pi), used only pre-session (New Workspace); live sessions let pi clamp and report
 * via `thinking_level_changed`. Pinned by ThinkingSelector.test.ts.
 */
export function snapThinkingLevel(
	supported: readonly ThinkingLevel[],
	desired: ThinkingLevel,
): ThinkingLevel {
	if (supported.includes(desired)) return desired;
	const at = LEVELS.indexOf(desired);
	for (let i = at + 1; i < LEVELS.length; i++) {
		const candidate = LEVELS[i];
		if (candidate && supported.includes(candidate)) return candidate;
	}
	for (let i = at - 1; i >= 0; i--) {
		const candidate = LEVELS[i];
		if (candidate && supported.includes(candidate)) return candidate;
	}
	return supported[0] ?? "off";
}

/**
 * The per-session effort picker (cheap win #1): a pill opening a list of the seven thinking levels — the
 * same trigger+popover shape as the model picker. Props-driven, no store — shared by the chat header and
 * the New-Workspace dialog.
 */
export function ThinkingSelector({
	level,
	onSelect,
	supportedLevels,
	container,
}: {
	level: ThinkingLevel;
	onSelect: (level: ThinkingLevel) => void;
	/** The active model's selectable levels (`WireModel.thinkingLevels`) — the rest render disabled.
	 * Absent ⇒ all seven enabled (no model context, e.g. before `model.default` resolves). */
	supportedLevels?: readonly ThinkingLevel[] | undefined;
	/** Popover portal target — the host Dialog node when used inside a dialog (so the list scrolls). */
	container?: HTMLElement | null;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				data-testid="thinking-selector"
				data-open={open}
				className="flex h-8 items-center gap-sm rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm text-sm text-text outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:border-[var(--primary-60)] data-[open=true]:bg-hover"
			>
				<span className="text-hint text-xs uppercase tracking-wider">Effort</span>
				<span className="capitalize">{level}</span>
				<ChevronDown className="size-3 shrink-0 text-hint" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[160px] p-xs">
				{LEVELS.map((l) => {
					const supported = !supportedLevels || supportedLevels.includes(l);
					return (
						<button
							key={l}
							type="button"
							data-testid="thinking-option"
							data-level={l}
							data-supported={supported}
							aria-pressed={l === level}
							disabled={!supported}
							onClick={() => {
								onSelect(l);
								setOpen(false);
							}}
							className="flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs text-left text-sm text-text capitalize outline-none transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:text-hint disabled:opacity-50 disabled:hover:bg-transparent"
						>
							<span className="flex w-3.5 shrink-0 justify-center">
								{l === level ? <Check className="size-3.5 text-primary" /> : null}
							</span>
							{l}
						</button>
					);
				})}
			</PopoverContent>
		</Popover>
	);
}
