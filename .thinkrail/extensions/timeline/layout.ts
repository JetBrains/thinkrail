import type { Span, Timeline } from "./model";

export interface Lane {
	id: string;
	head: Span;
	children: Span[];
	rows: number;
	row: ReadonlyMap<string, number>;
}

export interface Run {
	run: number;
	start: number;
	end: number;
	live: boolean;
	costUsd: number;
	lanes: Lane[];
}

export const endOf = (span: Span, now: number) => span.end ?? now;

export const formatCost = (usd: number) => {
	if (usd === 0) return "$0";
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	return `$${usd.toFixed(2)}`;
};

export const formatDuration = (ms: number) => {
	if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${Math.round(seconds % 60)}s`;
};

export const formatTokens = (count: number) =>
	count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k` : String(count);

const packRows = (spans: readonly Span[], now: number) => {
	const rowEnds: number[] = [];
	const row = new Map<string, number>();
	for (const span of [...spans].sort((a, b) => a.start - b.start)) {
		const free = rowEnds.findIndex((end) => end <= span.start);
		const index = free === -1 ? rowEnds.length : free;
		rowEnds[index] = endOf(span, now);
		row.set(span.id, index);
	}
	return { rows: Math.max(1, rowEnds.length), row };
};

const laneOf = (head: Span, children: Span[], now: number): Lane => ({
	id: head.id,
	head,
	children,
	...packRows(children, now),
});

export const runsOf = (timeline: Timeline | undefined, now: number): Run[] => {
	if (!timeline) return [];
	const byRun = new Map<number, Span[]>();
	for (const span of timeline.spans) byRun.set(span.run, [...(byRun.get(span.run) ?? []), span]);
	return [...byRun.entries()]
		.map(([run, spans]) => {
			const roots = spans.filter((span) => span.parentId === undefined);
			const lanes = roots
				.filter((span) => span.kind !== "tool")
				.map((head) =>
					laneOf(
						head,
						spans.filter((span) => span.parentId === head.id),
						now,
					),
				);
			const orphans = roots.filter((span) => span.kind === "tool");
			if (orphans.length > 0 && orphans[0])
				lanes.push(laneOf({ ...orphans[0], id: `r${run}-tools`, name: "Tools" }, orphans, now));
			const start = Math.min(...spans.map((span) => span.start));
			const end = Math.max(...spans.map((span) => endOf(span, now)));
			return {
				run,
				start,
				end: Math.max(end, start + 1),
				live: timeline.live && run === timeline.run,
				costUsd: spans.reduce((sum, span) => sum + (span.costUsd ?? 0), 0),
				lanes: lanes.sort((a, b) => a.head.start - b.head.start),
			};
		})
		.sort((a, b) => b.run - a.run);
};

export const percentOf = (value: number, start: number, end: number) =>
	Math.min(100, Math.max(0, ((value - start) / (end - start)) * 100));

interface FlameCell {
	span: Span;
	offset: number;
	width: number;
}

interface FlameColumn extends FlameCell {
	children: FlameCell[];
}

const cellsOf = <T extends { weight: number }>(items: readonly T[]) => {
	const total = items.reduce((sum, item) => sum + item.weight, 0);
	let offset = 0;
	return items.map((item) => {
		const width = total > 0 ? (item.weight / total) * 100 : 100 / items.length;
		const cell = { item, offset, width };
		offset += width;
		return cell;
	});
};

export const flameOf = (run: Run, now: number): FlameColumn[] => {
	const bySpend = run.costUsd > 0;
	const columns = cellsOf(
		run.lanes
			.filter((lane) => lane.head.kind !== "compaction")
			.map((lane) => ({
				lane,
				weight: bySpend
					? (lane.head.costUsd ?? 0)
					: Math.max(1, endOf(lane.head, now) - lane.head.start),
			})),
	);
	return columns.map(({ item, offset, width }) => ({
		span: item.lane.head,
		offset,
		width,
		children: cellsOf(
			item.lane.children.map((span) => ({
				span,
				weight: Math.max(1, endOf(span, now) - span.start),
			})),
		).map((cell) => ({
			span: cell.item.span,
			offset: offset + (cell.offset * width) / 100,
			width: (cell.width * width) / 100,
		})),
	}));
};
