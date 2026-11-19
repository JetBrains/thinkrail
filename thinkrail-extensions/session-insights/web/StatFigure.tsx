import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { isBadged } from "./copy";
import { FigureBadge, FigureDetails, type FigureView, type Sources } from "./FigureCell";

/** A labelled headline figure with its provenance tooltip; badged only when it is not exact. */
export function StatFigure({
	label,
	figures,
	sources,
	testId,
	sub,
	tone,
	children,
}: {
	label: string;
	figures: readonly FigureView[];
	sources: Sources;
	testId: string;
	sub?: ReactNode;
	tone?: "warning" | "error";
	children: ReactNode;
}) {
	const origin = figures[0]?.origin;
	return (
		<div
			data-testid={testId}
			className={cn(
				"flex min-w-0 flex-col rounded-md border px-8 py-4",
				tone === "warning"
					? "border-feedback-warning-muted"
					: tone === "error"
						? "border-feedback-error-muted"
						: "border-border-default",
			)}
		>
			<span className="truncate tr-text-caption text-text-subtle">{label}</span>
			<IconTooltip label={<FigureDetails figures={figures} sources={sources} />} align="start">
				<button
					type="button"
					className="flex min-w-0 items-center gap-4 rounded-sm text-left tr-text-ui text-text-default tabular-nums focus-visible:focus-ring"
				>
					<span className="truncate">{children}</span>
					{origin && isBadged(origin) ? <FigureBadge origin={origin} /> : null}
				</button>
			</IconTooltip>
			{sub ? <span className="truncate tr-text-metadata text-text-muted">{sub}</span> : null}
		</div>
	);
}
