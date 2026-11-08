import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";

export const SETTINGS_RANGE_INPUT =
	"absolute inset-0 h-24 w-full appearance-none bg-transparent focus-visible:outline-none [&::-moz-range-thumb]:size-16 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-border-default [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-16 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-border-default [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm focus-visible:[&::-moz-range-thumb]:ring-2 focus-visible:[&::-moz-range-thumb]:ring-primary focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-primary";

export const SETTINGS_RANGE_STACKED =
	"pointer-events-none [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:pointer-events-auto";

export function SettingsRangeTrack({
	steps,
	filled,
	marker,
	children,
}: {
	steps: readonly number[];
	filled: (start: number) => boolean;
	marker?: number;
	children: ReactNode;
}) {
	return (
		<div className="relative h-24">
			<div className="absolute inset-x-0 top-1/2 flex h-4 -translate-y-1/2 overflow-hidden rounded-full bg-control-bg">
				{steps.map((start) => (
					<span
						key={start}
						className={cn(
							"h-full flex-1",
							filled(start) ? "bg-primary" : "bg-control-bg",
							start === marker && "border-border-default border-l-2",
						)}
					/>
				))}
			</div>
			{children}
		</div>
	);
}
