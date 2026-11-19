import { cn } from "@thinkrail/ui/utils";

export interface BarPart {
	key: string;
	value: number;
	/** A `fill-*` token utility. */
	fill: string;
}

/** A horizontal bar of parts sized by their share of `total` (SVG, so widths need no inline style). */
export function ShareBar({
	parts,
	total,
	className,
	testId,
}: {
	parts: readonly BarPart[];
	total: number;
	className?: string;
	testId?: string;
}) {
	const whole = Math.max(1, total);
	const widths = parts.map((part) => (Math.max(0, part.value) / whole) * 100);
	const starts = widths.map((_, at) => widths.slice(0, at).reduce((sum, width) => sum + width, 0));
	return (
		<svg
			aria-hidden="true"
			data-testid={testId}
			viewBox="0 0 100 8"
			preserveAspectRatio="none"
			className={cn("h-8 w-full min-w-0 flex-1 rounded-sm bg-control-bg", className)}
		>
			{parts.map((part, at) => (
				<rect
					key={part.key}
					x={starts[at] ?? 0}
					y={0}
					width={widths[at] ?? 0}
					height={8}
					className={part.fill}
				/>
			))}
		</svg>
	);
}
