import {
	cn,
	remixicon,
	type SessionStats,
	type SurfaceProps,
	ui,
	useAction,
	useChannel,
} from "@thinkrail/ext/view";
import { type ReactNode, useMemo, useState } from "react";
import { useNow, useWatch } from "./hooks";
import { formatCost, formatDuration, type Run, runsOf } from "./layout";
import type { Span, Timeline } from "./model";
import { RunFlame, RunLanes, SpanDetail } from "./parts";

const { RiDeleteBinLine, RiFireLine, RiTimeLine } = remixicon;

type Mode = "lanes" | "flame";

const ModeButton = ({
	mode,
	current,
	onPick,
	children,
}: {
	mode: Mode;
	current: Mode;
	onPick: (mode: Mode) => void;
	children: ReactNode;
}) => (
	<button
		type="button"
		data-testid={`timeline-mode-${mode}`}
		aria-pressed={mode === current}
		onClick={() => onPick(mode)}
		className={cn(
			"flex items-center gap-4 rounded-sm px-8 py-2 tr-text-ui",
			mode === current
				? "bg-control-bg-selected text-text-default"
				: "text-text-muted hover:bg-control-bg-hovered",
		)}
	>
		{children}
	</button>
);

const RunHeader = ({ run, now }: { run: Run; now: number }) => {
	const errors = run.lanes.filter((lane) => lane.head.status === "error").length;
	return (
		<div className="flex items-center gap-8 tr-text-metadata text-text-muted">
			<span className="tr-text-ui text-text-default">Run {run.run}</span>
			{run.live ? (
				<span className="flex items-center gap-4 text-primary">
					<span className="size-8 animate-pulse rounded-full bg-primary" /> live
				</span>
			) : (
				<span>settled</span>
			)}
			<span>{formatDuration((run.live ? now : run.end) - run.start)}</span>
			{run.costUsd > 0 && <span>{formatCost(run.costUsd)}</span>}
			{errors > 0 && (
				<span className="text-feedback-error">
					{errors} error{errors === 1 ? "" : "s"}
				</span>
			)}
		</div>
	);
};

const Empty = ({ text }: { text: string }) => (
	<div
		data-testid="timeline-empty"
		className="flex h-full items-center justify-center p-24 text-center tr-text-ui text-text-muted"
	>
		{text}
	</div>
);

const TimelinePanel = ({ host }: SurfaceProps) => {
	const { sessionId } = host;
	useWatch(sessionId);
	const timeline = useChannel<Timeline>(sessionId ?? "");
	const stats = useChannel<SessionStats>(sessionId ? `cost:${sessionId}` : "");
	const clear = useAction("clear");
	const [mode, setMode] = useState<Mode>("lanes");
	const [selectedId, setSelectedId] = useState<string>();
	const now = useNow(timeline?.live ?? false);
	const runs = useMemo(() => runsOf(timeline, now), [timeline, now]);
	const selected = useMemo<Span | undefined>(
		() => timeline?.spans.find((span) => span.id === selectedId),
		[timeline, selectedId],
	);

	if (!sessionId) return <Empty text="Open a chat to see its timeline." />;
	return (
		<div data-testid="timeline-panel" className="flex h-full flex-col bg-container-workspace-bg">
			<div className="flex shrink-0 items-center gap-8 border-b border-border-muted px-12 py-8">
				<ModeButton mode="lanes" current={mode} onPick={setMode}>
					<RiTimeLine className="size-14" /> Timeline
				</ModeButton>
				<ModeButton mode="flame" current={mode} onPick={setMode}>
					<RiFireLine className="size-14" /> Cost flame
				</ModeButton>
				<span className="ml-auto tr-text-metadata text-text-muted" data-testid="timeline-total">
					{stats ? `${formatCost(stats.cost)} session` : ""}
				</span>
				<ui.IconTooltip label="Clear settled runs">
					<ui.Button
						variant="ghost"
						size="icon"
						aria-label="Clear settled runs"
						onClick={() => void clear()}
					>
						<RiDeleteBinLine className="size-14" />
					</ui.Button>
				</ui.IconTooltip>
			</div>
			{runs.length === 0 ? (
				<Empty text="No runs yet. Send a prompt and turns appear here live." />
			) : (
				<div className="flex min-h-0 flex-1 flex-col gap-24 overflow-y-auto p-12">
					{runs.map((run) => (
						<section key={run.run} data-testid="timeline-run" className="flex flex-col gap-8">
							<RunHeader run={run} now={now} />
							{mode === "lanes" ? (
								<RunLanes
									run={run}
									now={now}
									selectedId={selectedId}
									onSelect={(span) => setSelectedId(span.id)}
								/>
							) : (
								<RunFlame
									run={run}
									now={now}
									selectedId={selectedId}
									onSelect={(span) => setSelectedId(span.id)}
								/>
							)}
						</section>
					))}
					{(timeline?.dropped ?? 0) > 0 && (
						<p className="tr-text-metadata text-text-subtle">
							{timeline?.dropped} older spans dropped
						</p>
					)}
				</div>
			)}
			{selected && (
				<SpanDetail span={selected} now={now} onClose={() => setSelectedId(undefined)} />
			)}
		</div>
	);
};

export default TimelinePanel;
