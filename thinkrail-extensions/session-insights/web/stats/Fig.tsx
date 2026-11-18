import type { Origin } from "@thinkrail/pi-session-insights/core";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { FigureDetails, FigureValue, type FigureView, type Sources } from "../FigureCell";

/** A figure inside a statistics table or line: its text, a badge when inexact, its provenance tooltip. */
export function Fig({
	text,
	origin,
	figures,
	sources,
	testId,
	className,
}: {
	text: string;
	origin: Origin;
	figures: readonly FigureView[];
	sources: Sources;
	testId?: string;
	className?: string;
}) {
	return (
		<IconTooltip label={<FigureDetails figures={figures} sources={sources} />} align="end">
			<button
				type="button"
				data-testid={testId}
				data-origin={origin}
				className={cn(
					"inline-flex min-w-0 max-w-full justify-end rounded-sm tr-text-ui focus-visible:focus-ring",
					className,
				)}
			>
				<FigureValue text={text} origin={origin} />
			</button>
		</IconTooltip>
	);
}
