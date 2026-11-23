import { cn } from "@thinkrail/ui/utils";

const W = 100;
const H = 16;

/** A row's activity per sparkline point as a bar strip (SVG, token colours, no figures of its own). */
export function Sparkline({
	values,
	fill = "fill-series-1",
	testId,
}: {
	values: readonly number[];
	fill?: string;
	testId?: string;
}) {
	const max = Math.max(0, ...values);
	const n = Math.max(1, values.length);
	const width = W / n;
	let path = "";
	values.forEach((value, at) => {
		if (value <= 0 || max <= 0) return;
		const h = Math.max(1, (value / max) * H);
		path += `M${(at * width).toFixed(2)} ${H}v${(-h).toFixed(2)}h${Math.max(0.6, width * 0.8).toFixed(2)}v${h.toFixed(2)}z`;
	});
	return (
		<svg
			aria-hidden="true"
			data-testid={testId}
			viewBox={`0 0 ${W} ${H}`}
			preserveAspectRatio="none"
			className="h-16 w-96 shrink-0 border-border-muted border-b"
		>
			<path d={path} className={cn(fill)} />
		</svg>
	);
}
