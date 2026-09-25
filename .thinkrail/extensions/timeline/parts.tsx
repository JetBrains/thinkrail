import { cn, remixicon } from "@thinkrail/ext/view";
import { usePreview } from "./hooks";
import {
	endOf,
	flameOf,
	formatCost,
	formatDuration,
	formatTokens,
	type Lane,
	percentOf,
	type Run,
} from "./layout";
import type { Span } from "./model";

const { RiCloseLine, RiErrorWarningLine, RiLoader4Line, RiStackLine } = remixicon;

const ROW_PX = 16;
const BAR_PX = 12;

const barTone = (span: Span, selected: boolean) =>
	cn(
		"absolute h-12 min-w-2 cursor-pointer rounded-sm transition-colors",
		span.kind === "compaction" && "bg-feedback-warning-subtle",
		span.kind !== "compaction" && span.status === "running" && "animate-pulse bg-primary",
		span.kind !== "compaction" && span.status === "ok" && "bg-primary-muted hover:bg-primary",
		span.status === "error" && "bg-feedback-error-muted",
		selected && "ring-1 ring-primary",
	);

interface Selection {
	selectedId: string | undefined;
	onSelect: (span: Span) => void;
}

const Bar = ({
	span,
	left,
	width,
	top,
	selectedId,
	onSelect,
}: Selection & { span: Span; left: number; width: number; top: number }) => (
	<button
		type="button"
		data-testid="timeline-span"
		data-kind={span.kind}
		data-status={span.status}
		title={span.label ? `${span.name} · ${span.label}` : span.name}
		className={barTone(span, span.id === selectedId)}
		style={{ left: `${left}%`, width: `${width}%`, top }}
		onClick={() => onSelect(span)}
	/>
);

const laneCost = (lane: Lane) => (lane.head.costUsd ? formatCost(lane.head.costUsd) : undefined);

const LaneRow = ({
	lane,
	run,
	now,
	...pick
}: Selection & { lane: Lane; run: Run; now: number }) => {
	const { head } = lane;
	const headLeft = percentOf(head.start, run.start, run.end);
	const headWidth = Math.max(0.5, percentOf(endOf(head, now), run.start, run.end) - headLeft);
	const tools = lane.children.length;
	return (
		<div data-testid="timeline-lane" data-status={head.status} className="flex items-start gap-8">
			<button
				type="button"
				onClick={() => pick.onSelect(head)}
				className={cn(
					"flex w-112 shrink-0 flex-col items-start rounded-sm px-4 text-left hover:bg-control-bg-hovered",
					head.id === pick.selectedId && "bg-control-bg-selected",
				)}
			>
				<span className="flex items-center gap-4 tr-text-ui text-text-default">
					{head.status === "error" && (
						<RiErrorWarningLine className="size-14 text-feedback-error" />
					)}
					{head.kind === "compaction" && <RiStackLine className="size-14 text-feedback-warning" />}
					{head.name}
				</span>
				<span className="whitespace-nowrap tr-text-metadata text-text-subtle">
					{[laneCost(lane), tools > 0 ? `${tools} tool${tools === 1 ? "" : "s"}` : undefined]
						.filter(Boolean)
						.join(" · ") || formatDuration(endOf(head, now) - head.start)}
				</span>
			</button>
			<div
				className="relative min-w-0 flex-1 rounded-sm bg-control-bg"
				style={{ height: lane.rows * ROW_PX + 4 }}
			>
				<div
					className={cn(
						"absolute inset-y-0 rounded-sm",
						head.kind === "compaction" ? "bg-feedback-warning-subtle" : "bg-primary-subtle",
					)}
					style={{ left: `${headLeft}%`, width: `${headWidth}%` }}
				/>
				{lane.children.map((span) => {
					const left = percentOf(span.start, run.start, run.end);
					const width = Math.max(0.5, percentOf(endOf(span, now), run.start, run.end) - left);
					return (
						<Bar
							key={span.id}
							span={span}
							left={left}
							width={width}
							top={2 + (lane.row.get(span.id) ?? 0) * ROW_PX}
							{...pick}
						/>
					);
				})}
			</div>
		</div>
	);
};

const TICKS = [0, 0.25, 0.5, 0.75, 1];

const Axis = ({ run }: { run: Run }) => (
	<div className="flex items-center gap-8" aria-hidden>
		<span className="w-112 shrink-0" />
		<div className="relative h-12 min-w-0 flex-1 tr-text-metadata text-text-subtle">
			{TICKS.map((tick) => (
				<span
					key={tick}
					className={cn(
						"absolute top-0 whitespace-nowrap",
						tick === 1 ? "-translate-x-full" : tick > 0 && "-translate-x-1/2",
					)}
					style={{ left: `${tick * 100}%` }}
				>
					{tick === 0 ? "0s" : formatDuration((run.end - run.start) * tick)}
				</span>
			))}
		</div>
	</div>
);

export const RunLanes = ({ run, now, ...pick }: Selection & { run: Run; now: number }) => (
	<div className="flex flex-col gap-4">
		<Axis run={run} />
		{run.lanes.map((lane) => (
			<LaneRow key={lane.id} lane={lane} run={run} now={now} {...pick} />
		))}
	</div>
);

export const RunFlame = ({ run, now, ...pick }: Selection & { run: Run; now: number }) => {
	const columns = flameOf(run, now);
	return (
		<div data-testid="timeline-flame" className="flex flex-col gap-2">
			<div className="relative h-24">
				{columns.map((column) => (
					<button
						key={column.span.id}
						type="button"
						data-testid="timeline-flame-turn"
						title={`${column.span.name} · ${formatCost(column.span.costUsd ?? 0)}`}
						onClick={() => pick.onSelect(column.span)}
						className={cn(
							"absolute inset-y-0 overflow-hidden rounded-sm border border-container-workspace-bg px-4 text-left tr-text-metadata",
							column.span.status === "error"
								? "bg-feedback-error-muted text-text-default"
								: "bg-primary-soft text-text-default hover:bg-primary-muted",
							column.span.id === pick.selectedId && "ring-1 ring-primary",
						)}
						style={{ left: `${column.offset}%`, width: `${column.width}%` }}
					>
						<span className="truncate">
							{column.span.name} {formatCost(column.span.costUsd ?? 0)}
						</span>
					</button>
				))}
			</div>
			<div className="relative" style={{ height: BAR_PX + 4 }}>
				{columns.flatMap((column) =>
					column.children.map((cell) => (
						<Bar
							key={cell.span.id}
							span={cell.span}
							left={cell.offset}
							width={cell.width}
							top={2}
							{...pick}
						/>
					)),
				)}
			</div>
		</div>
	);
};

const statusLabel = (span: Span) => {
	if (span.status === "running")
		return (
			<span className="flex items-center gap-4 text-primary">
				<RiLoader4Line className="size-14 animate-spin" /> running
			</span>
		);
	return (
		<span className={span.status === "error" ? "text-feedback-error" : "text-feedback-success"}>
			{span.status}
		</span>
	);
};

export const SpanDetail = ({
	span,
	now,
	onClose,
}: {
	span: Span;
	now: number;
	onClose: () => void;
}) => {
	const preview = usePreview(span);
	return (
		<div
			data-testid="timeline-detail"
			className="flex max-h-[40%] shrink-0 flex-col gap-8 border-t border-border-default bg-container-elevated-bg p-12"
		>
			<div className="flex items-start justify-between gap-8">
				<div className="flex min-w-0 flex-col gap-2">
					<span className="truncate tr-title-compact text-text-default">{span.name}</span>
					{span.label && (
						<span className="truncate tr-code-text text-text-muted">{span.label}</span>
					)}
				</div>
				<button
					type="button"
					aria-label="Close detail"
					onClick={onClose}
					className="rounded-sm p-2 text-text-muted hover:bg-control-bg-hovered"
				>
					<RiCloseLine className="size-16" />
				</button>
			</div>
			<div className="flex flex-wrap gap-12 tr-text-metadata text-text-muted">
				{statusLabel(span)}
				<span>{formatDuration(endOf(span, now) - span.start)}</span>
				{span.tokens && (
					<span>
						{formatTokens(span.tokens.in)} in · {formatTokens(span.tokens.out)} out ·{" "}
						{formatTokens(span.tokens.cacheRead)} cached
					</span>
				)}
				{span.costUsd !== undefined && <span>{formatCost(span.costUsd)}</span>}
			</div>
			{preview && (
				<pre
					data-testid="timeline-preview"
					className="min-h-0 overflow-auto whitespace-pre-wrap rounded-md bg-container-content-bg p-8 tr-code-text text-text-default"
				>
					{preview}
				</pre>
			)}
		</div>
	);
};
